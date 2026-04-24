from flask import Flask, render_template, request, jsonify, session, g
import json
import sqlite3
import os
import re
from datetime import datetime

# Force-load user config overrides from .env.example
if os.path.exists('.env.example'):
    with open('.env.example', 'r') as env_f:
        for _line in env_f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ[_k.strip()] = _v.strip()

import requests
from requests.auth import HTTPBasicAuth
import razorpay

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'super_secret_key_prod')

DATABASE = 'quiz.db'
RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', 'rzp_test_dummykey')
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', 'dummysecret')
WEBHOOK_SECRET = os.environ.get('RAZORPAY_WEBHOOK_SECRET', 'webhook_sec')

razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', 'admin123')

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=WAL')
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS QuizResults (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES Users(id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                razorpay_order_id TEXT NOT NULL,
                razorpay_payment_id TEXT,
                status TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES Users(id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Winners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL,
                rank INTEGER NOT NULL,
                prize_amount INTEGER NOT NULL,
                awarded_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES Users(id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS PayoutDetails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                winner_id INTEGER UNIQUE NOT NULL,
                full_name TEXT NOT NULL,
                upi_id TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                FOREIGN KEY (winner_id) REFERENCES Winners(id)
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS PayoutTransactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                winner_id INTEGER NOT NULL,
                payout_id TEXT NOT NULL,
                status TEXT NOT NULL,
                amount INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (winner_id) REFERENCES Winners(id),
                FOREIGN KEY (user_id) REFERENCES Users(id)
            )
        ''')
        db.commit()

def load_questions():
    with open('questions.json', 'r') as f:
        return json.load(f)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/webhook/razorpay', methods=['POST'])
def razorpay_webhook():
    webhook_body = request.get_data(as_text=True)
    webhook_signature = request.headers.get('X-Razorpay-Signature')
    try:
        if RAZORPAY_KEY_ID != 'rzp_test_dummykey':
            razorpay_client.utility.verify_webhook_signature(
                webhook_body, webhook_signature, WEBHOOK_SECRET)
        event = request.json
        if not event: return jsonify({"error": "Empty"}), 400
            
        db = get_db()
        cursor = db.cursor()
        
        if event.get('event') == 'payment.captured':
            payment_id = event['payload']['payment']['entity']['id']
            order_id = event['payload']['payment']['entity']['order_id']
            cursor.execute("UPDATE Payments SET razorpay_payment_id = ?, status = 'success' WHERE razorpay_order_id = ?",
                           (payment_id, order_id))
        elif event.get('event') == 'payout.processed':
            payout_id = event['payload']['payout']['entity']['id']
            cursor.execute("UPDATE PayoutTransactions SET status = 'processed' WHERE payout_id = ?", (payout_id,))
        elif event.get('event') in ['payout.failed', 'payout.rejected']:
            payout_id = event['payload']['payout']['entity']['id']
            cursor.execute("UPDATE PayoutTransactions SET status = 'failed' WHERE payout_id = ?", (payout_id,))
        db.commit()
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/create_order', methods=['POST'])
def create_order():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    amount = 3000
    
    if not name or not email:
        return jsonify({"error": "User name and email required"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id FROM Users WHERE email = ?', (email,))
    user_row = cursor.fetchone()
    if user_row:
        user_id = user_row['id']
        cursor.execute('UPDATE Users SET name = ? WHERE id = ?', (name, user_id))
        
        cursor.execute('SELECT id FROM QuizResults WHERE user_id = ?', (user_id,))
        if cursor.fetchone():
            return jsonify({"error": "Access Denied. You have already submitted this quiz once!"}), 403
    else:
        cursor.execute('INSERT INTO Users (name, email) VALUES (?, ?)', (name, email))
        user_id = cursor.lastrowid
    db.commit()

    try:
        try:
            # Attempt to use whatever keys are in the environment natively
            order = razorpay_client.order.create({
                "amount": amount,
                "currency": "INR",
                "receipt": f"receipt_{user_id}_{int(datetime.now().timestamp())}",
                "payment_capture": "1"
            })
            forced_key = RAZORPAY_KEY_ID
        except Exception:
            # Fallback for ANY invalid key, broken environment variable, or dummy string
            order = {'id': f'order_mock_{user_id}_{int(datetime.now().timestamp())}'}
            forced_key = 'rzp_test_dummykey'
            
        cursor.execute('INSERT INTO Payments (user_id, razorpay_order_id, status) VALUES (?, ?, ?)', 
                       (user_id, order['id'], 'created'))
        db.commit()
        return jsonify({
            "order_id": order['id'],
            "amount": amount,
            "currency": "INR",
            "key": forced_key,
            "user_id": user_id
        })
    except Exception as e:
        return jsonify({"error": f"Database Error: {str(e)}"}), 500

@app.route('/api/verify_payment', methods=['POST'])
def verify_payment():
    data = request.json
    razorpay_payment_id = data.get('razorpay_payment_id')
    razorpay_order_id = data.get('razorpay_order_id')
    razorpay_signature = data.get('razorpay_signature')
    
    try:
        if RAZORPAY_KEY_ID != 'rzp_test_dummykey':
            razorpay_client.utility.verify_payment_signature({
                'razorpay_order_id': razorpay_order_id,
                'razorpay_payment_id': razorpay_payment_id,
                'razorpay_signature': razorpay_signature
            })
            
        db = get_db()
        cursor = db.cursor()
        cursor.execute("UPDATE Payments SET razorpay_payment_id = ?, status = 'success' WHERE razorpay_order_id = ?",
                       (razorpay_payment_id, razorpay_order_id))
        db.commit()
        return jsonify({"status": "success", "message": "Payment verified"})
    except razorpay.errors.SignatureVerificationError:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("UPDATE Payments SET razorpay_payment_id = ?, status = 'failed' WHERE razorpay_order_id = ?",
                       (razorpay_payment_id, razorpay_order_id))
        db.commit()
        return jsonify({"status": "failed", "message": "Signature verification failed"}), 400

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT Users.name, MAX(QuizResults.score) as max_score, QuizResults.total, MIN(QuizResults.timestamp) as best_time 
        FROM QuizResults 
        JOIN Users ON QuizResults.user_id = Users.id 
        GROUP BY Users.id 
        ORDER BY max_score DESC, best_time ASC 
        LIMIT 10
    ''')
    top_scores = [dict(row) for row in cursor.fetchall()]
    return jsonify(top_scores)

@app.route('/api/select_winners', methods=['POST'])
def select_winners():
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT COUNT(*) as count FROM Winners')
    if cursor.fetchone()['count'] > 0:
        return jsonify({"error": "Winners have already been awarded for this contest!"}), 400
        
    cursor.execute('''
        SELECT Users.id as user_id, Users.name
        FROM QuizResults 
        JOIN Users ON QuizResults.user_id = Users.id 
        GROUP BY Users.id 
        ORDER BY MAX(QuizResults.score) DESC, MIN(QuizResults.timestamp) ASC 
        LIMIT 3
    ''')
    top_3 = cursor.fetchall()
    
    if not top_3:
        return jsonify({"error": "Not enough participants yet."}), 400
        
    prizes = {1: 150, 2: 100, 3: 50}
    timestamp = datetime.now().isoformat()
    
    for rank, row in enumerate(top_3[:3], start=1):
        prize = prizes.get(rank, 0)
        cursor.execute('''
            INSERT INTO Winners (user_id, rank, prize_amount, awarded_at)
            VALUES (?, ?, ?, ?)
        ''', (row['user_id'], rank, prize, timestamp))
        
    db.commit()
    return jsonify({"message": f"Successfully finalized and saved {len(top_3)} winners!"})

@app.route('/api/winners', methods=['GET'])
def get_winners():
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT Users.name, Users.email, Winners.rank, Winners.prize_amount
        FROM Winners
        JOIN Users ON Winners.user_id = Users.id
        ORDER BY Winners.rank ASC
    ''')
    winners = [dict(row) for row in cursor.fetchall()]
    return jsonify(winners)

@app.route('/api/submit_payout', methods=['POST'])
def submit_payout():
    data = request.json
    email = data.get('email')
    full_name = data.get('full_name')
    upi_id = data.get('upi_id')

    if not all([email, full_name, upi_id]):
        return jsonify({"error": "Email, full name, and UPI ID are required"}), 400

    if not re.match(r'^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,64}$', upi_id):
        return jsonify({"error": "Invalid UPI format. Example: you@upi"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        SELECT Winners.id as winner_id 
        FROM Winners 
        JOIN Users ON Winners.user_id = Users.id 
        WHERE Users.email = ?
    ''', (email,))
    
    winner_row = cursor.fetchone()
    if not winner_row:
        return jsonify({"error": "Access Denied. Email address is not matched with a finalized winner."}), 403

    winner_id = winner_row['winner_id']
    timestamp = datetime.now().isoformat()
    
    try:
        cursor.execute('SELECT id FROM PayoutDetails WHERE winner_id = ?', (winner_id,))
        if cursor.fetchone():
            cursor.execute('UPDATE PayoutDetails SET full_name=?, upi_id=?, submitted_at=? WHERE winner_id=?',
                           (full_name, upi_id, timestamp, winner_id))
        else:
            cursor.execute('INSERT INTO PayoutDetails (winner_id, full_name, upi_id, submitted_at) VALUES (?, ?, ?, ?)',
                           (winner_id, full_name, upi_id, timestamp))
        db.commit()
    except Exception as e:
        return jsonify({"error": "Failed to save payout details"}), 500

    return jsonify({"message": "Successfully registered your UPI Payout Details!"})

@app.route('/api/admin/data', methods=['GET'])
def admin_data():
    token = request.headers.get('X-Admin-Token')
    if token != ADMIN_TOKEN:
        return jsonify({"error": "Unauthorized Access"}), 401
        
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('''
         SELECT Users.id, Users.name, Users.email, COUNT(QuizResults.id) as attempts
         FROM Users 
         LEFT JOIN QuizResults ON Users.id = QuizResults.user_id
         GROUP BY Users.id
    ''')
    users = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute('SELECT * FROM Payments ORDER BY id DESC LIMIT 50')
    payments = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute('''
        SELECT Winners.rank, Winners.prize_amount, Users.name, Users.email, PayoutDetails.upi_id
        FROM Winners 
        JOIN Users ON Winners.user_id = Users.id
        LEFT JOIN PayoutDetails ON Winners.id = PayoutDetails.winner_id
    ''')
    winners = [dict(r) for r in cursor.fetchall()]

    return jsonify({
        "users": users,
        "payments": payments,
        "winners": winners
    })

@app.route('/api/trigger_payouts', methods=['POST'])
def trigger_payouts():
    token = request.headers.get('X-Admin-Token')
    if token != ADMIN_TOKEN:
        return jsonify({"error": "Unauthorized Access"}), 401
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('''
        SELECT PayoutDetails.full_name, PayoutDetails.upi_id, 
               Winners.id as winner_id, Winners.user_id, Winners.prize_amount, Users.email
        FROM PayoutDetails
        JOIN Winners ON PayoutDetails.winner_id = Winners.id
        JOIN Users ON Winners.user_id = Users.id
        LEFT JOIN PayoutTransactions ON PayoutTransactions.winner_id = Winners.id
        WHERE PayoutTransactions.id IS NULL OR PayoutTransactions.status = 'failed'
    ''')
    pending_payouts = cursor.fetchall()
    
    if not pending_payouts:
        return jsonify({"message": "No pending payouts to process! All finalized winners have either been processed or have not logged their UPI details yet."})
        
    results = []
    
    for p in pending_payouts:
        amount_paise = p['prize_amount'] * 100
        payload = {
            "account_number": os.environ.get('RAZORPAYX_ACCOUNT_NUMBER', '7878780080316316'),
            "amount": amount_paise,
            "currency": "INR",
            "mode": "UPI",
            "purpose": "payout",
            "fund_account": {
                "account_type": "vpa",
                "vpa": {"address": p['upi_id']},
                "contact": {
                    "name": p['full_name'],
                    "email": p['email'],
                    "contact": "9999999999", 
                    "type": "customer", 
                    "reference_id": f"uid_{p['user_id']}"
                }
            },
            "queue_if_low_balance": True,
            "reference_id": f"pay_{p['winner_id']}_{int(datetime.now().timestamp())}"
        }
        
        try:
            response = requests.post(
                'https://api.razorpay.com/v1/payouts',
                json=payload,
                auth=HTTPBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
            )
            data = response.json()
            
            if RAZORPAY_KEY_ID == 'rzp_test_dummykey':
                data = { "id": f"pout_mock_{p['winner_id']}", "status": "processed" }

            if 'error' in data:
                status = 'failed'
                payout_id = data.get('error', {}).get('description', 'Unknown Error')[:200]
            else:
                status = data.get('status', 'pending')
                payout_id = data.get('id', 'unknown')
                
            cursor.execute('''
                INSERT INTO PayoutTransactions (user_id, winner_id, payout_id, status, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (p['user_id'], p['winner_id'], payout_id, status, p['prize_amount'], datetime.now().isoformat()))
            db.commit()
            
            results.append({"email": p['email'], "status": status, "payout_id": payout_id})
            
        except Exception as e:
            results.append({"email": p['email'], "status": "error", "error": str(e)})

    return jsonify({"message": "Batch Trigger complete.", "results": results})

@app.route('/api/questions', methods=['POST'])
def get_questions():
    data = request.json
    email = data.get('email')
    
    if not email:
        return jsonify({"error": "User email required"}), 400
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT Users.id as uid, Payments.status 
        FROM Users 
        LEFT JOIN Payments ON Users.id = Payments.user_id 
        WHERE Users.email = ? AND Payments.status = 'success'
    ''', (email,))
    
    user_data = cursor.fetchone()
    if not user_data:
        return jsonify({"error": "Please complete payment"}), 403
        
    cursor.execute('SELECT id FROM QuizResults WHERE user_id = ?', (user_data['uid'],))
    if cursor.fetchone():
        return jsonify({"error": "Access Denied. You have already completed the quiz!"}), 403
        
    questions = load_questions()
    safe_questions = [{"id": q["id"], "text": q["text"], "options": q["options"]} for q in questions]
    return jsonify(safe_questions)

@app.route('/api/submit', methods=['POST'])
def submit_quiz():
    data = request.json
    user_info = data.get('user', {})
    user_answers = data.get('answers', {})
    email = user_info.get('email')
    
    if not email:
        return jsonify({"error": "User email required"}), 400
        
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT Users.id as uid, Payments.status 
        FROM Users 
        LEFT JOIN Payments ON Users.id = Payments.user_id 
        WHERE Users.email = ? AND Payments.status = 'success'
    ''', (email,))
    
    user_data = cursor.fetchone()
    if not user_data:
        return jsonify({"error": "Please complete payment"}), 403
        
    cursor.execute('SELECT id FROM QuizResults WHERE user_id = ?', (user_data['uid'],))
    if cursor.fetchone():
        return jsonify({"error": "Access Denied. Score already submitted!"}), 403
    
    questions = load_questions()
    score = sum(1 for q in questions if str(q['id']) in user_answers and int(user_answers[str(q['id'])]) == q['answer'])
    total = len(questions)

    timestamp = datetime.now().isoformat()
    cursor.execute('INSERT INTO QuizResults (user_id, score, total, timestamp) VALUES (?, ?, ?, ?)', 
                   (user_data['uid'], score, total, timestamp))
    db.commit()
                
    return jsonify({
        "score": score,
        "total": total,
        "percentage": (score / total) * 100,
        "message": "Result saved successfully"
    })

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
