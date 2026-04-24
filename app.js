document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const startScreen = document.getElementById('start-screen');
    const leaderboardScreen = document.getElementById('leaderboard-screen');
    const payoutScreen = document.getElementById('payout-screen');
    const quizScreen = document.getElementById('quiz-screen');
    const resultScreen = document.getElementById('result-screen');
    
    // Auth & Admin specific DOM
    const adminTrigger = document.getElementById('admin-trigger');
    const adminScreen = document.getElementById('admin-screen');
    const adminLogin = document.getElementById('admin-login');
    const adminPanel = document.getElementById('admin-panel');
    const adminLoginBtn = document.getElementById('admin-login-btn');
    const adminTokenInput = document.getElementById('admin-token');
    
    // Tabs
    const adminTabUsers = document.getElementById('admin-tab-users');
    const adminTabAction = document.getElementById('admin-tab-action');
    const adminViewData = document.getElementById('admin-view-data');
    const adminViewAction = document.getElementById('admin-view-action');
    const adminUsersList = document.getElementById('admin-users-list');
    const adminPaymentsList = document.getElementById('admin-payments-list');
    const adminWinnersList = document.getElementById('admin-winners-list');

    const triggerPayoutsBtn = document.getElementById('trigger-payouts-btn');
    const payoutResults = document.getElementById('payout-results');
    const adminCloseBtn = document.getElementById('admin-close-btn');
    const adminExitBtn = document.getElementById('admin-exit-btn');
    let adminTokenMap = '';
    
    const startForm = document.getElementById('start-form');
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    const backToHomeBtn = document.getElementById('back-to-home-btn');
    const leaderboardBody = document.getElementById('leaderboard-body');
    const finalizeWinnersBtn = document.getElementById('finalize-winners-btn');
    const claimPrizeBtn = document.getElementById('claim-prize-btn');
    const winnersAnnouncement = document.getElementById('winners-announcement');
    const winnersList = document.getElementById('winners-list');
    
    // Payout DOM
    const payoutForm = document.getElementById('payout-form');
    const cancelPayoutBtn = document.getElementById('cancel-payout-btn');
    
    const displayName = document.getElementById('display-name');
    const timeLeftEl = document.getElementById('time-left');
    const questionContainer = document.getElementById('question-container');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    const progressEl = document.getElementById('progress');
    const startBtn = document.querySelector('#start-form .primary-btn');
    
    const scoreValueEl = document.getElementById('score-value');
    const totalValueEl = document.getElementById('total-value');
    const accuracyValueEl = document.getElementById('accuracy-value');
    const scoreCircle = document.querySelector('.score-circle');
    const restartBtn = document.getElementById('restart-btn');

    // State Variables
    let currentUser = { name: '', email: '' }; 
    let questions = [];
    let currentQuestionIndex = 0;
    let userAnswers = {}; 
    let timerInterval;
    const TIME_LIMIT_MINUTES = 10;
    let timeRemaining = TIME_LIMIT_MINUTES * 60;

    document.getElementById('name').addEventListener('input', (e) => { currentUser.name = e.target.value.trim(); });
    document.getElementById('email').addEventListener('input', (e) => { currentUser.email = e.target.value.trim(); });
    
    startForm.addEventListener('submit', handleStartQuiz);
    prevBtn.addEventListener('click', handlePrevQuestion);
    nextBtn.addEventListener('click', handleNextQuestion);
    submitBtn.addEventListener('click', submitQuiz);
    restartBtn.addEventListener('click', resetQuiz);

    leaderboardBtn.addEventListener('click', async () => {
        try {
            leaderboardBtn.textContent = 'Loading...';
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            
            let html = '';
            if (data.length === 0) {
                html = '<tr><td colspan="3" style="text-align: center;">No scores yet! Be the first.</td></tr>';
            } else {
                data.forEach((entry, idx) => {
                    const rankClass = idx < 3 ? `rank-${idx + 1}` : '';
                    html += `
                        <tr>
                            <td><span class="rank-badge ${rankClass}">${idx + 1}</span></td>
                            <td>${entry.name}</td>
                            <td><strong>${entry.max_score}</strong> / ${entry.total}</td>
                        </tr>
                    `;
                });
            }
            leaderboardBody.innerHTML = html;
            
            await loadWinners();
            switchScreen(startScreen, leaderboardScreen);
        } catch(err) {
            alert("Could not load leaderboard.");
        } finally {
            leaderboardBtn.textContent = 'View Leaderboard';
        }
    });

    backToHomeBtn.addEventListener('click', () => { switchScreen(leaderboardScreen, startScreen); });

    finalizeWinnersBtn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to finalize the winners? This cannot be undone and duplicate awards are blocked.")) return;
        try {
            const res = await fetch('/api/select_winners', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                alert(data.message);
                await loadWinners();
            } else {
                alert(data.error);
                await loadWinners();
            }
        } catch (err) {
            alert("Error finalizing winners.");
        }
    });

    async function loadWinners() {
        try {
            const res = await fetch('/api/winners');
            const data = await res.json();
            
            if (data.length > 0) {
                let html = '';
                let isClientWinner = false;
                
                data.forEach(w => {
                    if (currentUser && currentUser.email === w.email) {
                        isClientWinner = true;
                    }
                    html += `<div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 1.1rem;">
                        <strong>Rank ${w.rank}: ${w.name}</strong>
                        <span style="font-weight: bold;">Prize: ₹${w.prize_amount}</span>
                    </div>`;
                });
                winnersList.innerHTML = html;
                winnersAnnouncement.classList.remove('hidden');
                finalizeWinnersBtn.classList.add('hidden'); 
                
                if (isClientWinner) {
                    claimPrizeBtn.classList.remove('hidden');
                } else {
                    claimPrizeBtn.classList.add('hidden');
                }
            } else {
                claimPrizeBtn.classList.add('hidden');
                winnersAnnouncement.classList.add('hidden');
                finalizeWinnersBtn.classList.remove('hidden');
            }
        } catch (error) {
            console.error(error);
        }
    }

    // --- Admin Hooks ---
    adminTrigger.addEventListener('click', () => {
        adminScreen.classList.remove('hidden');
        adminScreen.classList.add('active');
    });

    const closeAdmin = () => {
        adminScreen.classList.remove('active');
        adminScreen.classList.add('hidden');
        adminTokenInput.value = '';
        adminTokenMap = '';
        adminPanel.classList.add('hidden');
        adminLogin.classList.remove('hidden');
        adminTabUsers.click();
    };

    adminCloseBtn.addEventListener('click', closeAdmin);
    adminExitBtn.addEventListener('click', closeAdmin);
    
    adminTabUsers.addEventListener('click', () => {
        adminTabUsers.className = 'btn primary-btn';
        adminTabAction.className = 'btn secondary-btn';
        adminViewData.classList.remove('hidden');
        adminViewAction.classList.add('hidden');
    });
    
    adminTabAction.addEventListener('click', () => {
        adminTabAction.className = 'btn primary-btn';
        adminTabUsers.className = 'btn secondary-btn';
        adminViewData.classList.add('hidden');
        adminViewAction.classList.remove('hidden');
    });

    adminLoginBtn.addEventListener('click', async () => {
        adminTokenMap = adminTokenInput.value.trim();
        if (adminTokenMap) {
            try {
                const res = await fetch('/api/admin/data', { headers: { 'X-Admin-Token': adminTokenMap } });
                const data = await res.json();
                
                if (res.ok) {
                    adminLogin.classList.add('hidden');
                    adminPanel.classList.remove('hidden');
                    adminTabUsers.click(); 
                    
                    if (data.users.length) {
                        adminUsersList.innerHTML = data.users.map(u => `UID ${u.id}: [${u.attempts||0} atmts] ${u.email}`).join('<br>');
                    } else adminUsersList.innerHTML = 'No users yet.';
                    
                    if (data.payments.length) {
                        adminPaymentsList.innerHTML = data.payments.map(p => `Ord ID: ${p.razorpay_order_id.slice(-8)}... | Status: <b>${p.status}</b>`).join('<br>');    
                    } else adminPaymentsList.innerHTML = 'No payments caught.';
                    
                    if (data.winners.length) {
                        adminWinnersList.innerHTML = data.winners.map(w => `Rnk ${w.rank}: ${w.email} | UPI: ${w.upi_id || 'unclaimed'}`).join('<br>');
                    } else adminWinnersList.innerHTML = 'Contest not finalized yet.';
                } else {
                    alert('Invalid Admin Token Authentication Rejected!');
                    adminTokenMap = '';
                }
            } catch (e) { alert('Error logging into Server.'); }
        }
    });

    triggerPayoutsBtn.addEventListener('click', async () => {
        try {
            triggerPayoutsBtn.textContent = 'Processing Payouts securely...';
            triggerPayoutsBtn.disabled = true;
            payoutResults.innerHTML = '> Contacting RazorpayX Nodes...<br>';
            
            const res = await fetch('/api/trigger_payouts', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-Token': adminTokenMap
                }
            });
            
            const data = await res.json();
            
            if (res.ok) {
                payoutResults.innerHTML += `<br><span style="color: var(--success)">[OK] ${data.message}</span><br><br>`;
                if (data.results && data.results.length > 0) {
                    data.results.forEach(r => {
                        const col = r.status.includes('error') || r.status.includes('failed') ? 'var(--danger)' : 'yellow';
                        payoutResults.innerHTML += `-> ${r.email} | Stat: <strong style="color: ${col};">[${r.status.toUpperCase()}]</strong> | Tx: ${r.payout_id || 'N/A'}<br>`;
                    });
                } else {
                    payoutResults.innerHTML += '<br>-> Queue empty. All users processed or missing UPI claims.';
                }
            } else {
                payoutResults.innerHTML += `<br><span style="color: var(--danger)">[DENIED] Error: ${data.error}</span><br>`;
                if (res.status === 401) setTimeout(closeAdmin, 2500);
            }
        } catch (err) {
            payoutResults.innerHTML += `<br><span style="color: var(--danger)">[FATAL] System Error connecting to backend logic limits.</span>`;
        } finally {
            triggerPayoutsBtn.textContent = 'Trigger Live Razorpay Payouts';
            triggerPayoutsBtn.disabled = false;
        }
    });


    // --- Payout Hooks ---
    claimPrizeBtn.addEventListener('click', () => { switchScreen(leaderboardScreen, payoutScreen); });
    cancelPayoutBtn.addEventListener('click', () => { switchScreen(payoutScreen, leaderboardScreen); });

    payoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('payout-name').value.trim();
        const upiId = document.getElementById('payout-upi').value.trim();
        const upiRegex = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/;
        if (!upiRegex.test(upiId)) {
            alert("Invalid UPI ID format. Please double-check it. (e.g. user@bank)");
            return;
        }

        try {
            const btn = payoutForm.querySelector('button[type="submit"]');
            btn.textContent = 'Submitting...';
            btn.disabled = true;
            const res = await fetch('/api/submit_payout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentUser.email, full_name: fullName, upi_id: upiId })
            });
            const data = await res.json();
            
            if (res.ok) {
                alert(data.message);
                switchScreen(payoutScreen, leaderboardScreen);
                claimPrizeBtn.classList.add('hidden'); 
            } else {
                alert(data.error);
            }
            btn.textContent = 'Confirm Claim';
            btn.disabled = false;
        } catch (err) {
            alert("Error trying to process the UPI payout details.");
        }
    });

    async function handleStartQuiz(e) {
        e.preventDefault();
        if (!currentUser.name || !currentUser.email) return;
        
        try {
            const checkRes = await fetch('/api/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentUser.email })
            });

            if (checkRes.ok) {
                questions = await checkRes.json();
                if (questions.length > 0) {
                    displayName.textContent = currentUser.name;
                    switchScreen(startScreen, quizScreen);
                    startTimer();
                    renderQuestion();
                    updateProgress();
                    return;
                }
            } else {
                const data = await checkRes.json();
                if (data.error && data.error.includes("already")) {
                    alert(data.error);
                    return;
                }
            }
        } catch (error) {}
        
        try {
            startBtn.textContent = "Processing...";
            startBtn.disabled = true;
            leaderboardBtn.disabled = true;
            
            const orderRes = await fetch('/api/create_order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentUser)
            });
            const orderData = await orderRes.json();
            
            if (orderRes.ok) {
                if (orderData.key === 'rzp_test_dummykey') {
                    const verifyRes = await fetch('/api/verify_payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            razorpay_payment_id: "pay_mock_12345",
                            razorpay_order_id: orderData.order_id,
                            razorpay_signature: "mock_signature"
                        })
                    });
                    const verifyData = await verifyRes.json();
                    if (verifyRes.ok && verifyData.status === "success") {
                        displayName.textContent = currentUser.name;
                        await fetchAndStartQuiz();
                    } else alert("Mock Payment verification failed.");
                } else {
                    const options = {
                        "key": orderData.key,
                        "amount": orderData.amount,
                        "currency": orderData.currency,
                        "name": "DSA Quiz Master",
                        "description": "Premium Quiz Entry",
                        "order_id": orderData.order_id,
                        "handler": async function (response){
                            const verifyRes = await fetch('/api/verify_payment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_signature: response.razorpay_signature
                                })
                            });
                            const verifyData = await verifyRes.json();
                            if (verifyRes.ok && verifyData.status === "success") {
                                displayName.textContent = currentUser.name;
                                await fetchAndStartQuiz();
                            } else {
                                alert("Payment verification failed. Please complete payment.");
                            }
                        },
                        "prefill": {"name": currentUser.name, "email": currentUser.email},
                        "theme": {"color": "#6366f1"}
                    };
                    const rzp = new window.Razorpay(options);
                    rzp.on('payment.failed', function (response){
                        alert("Payment failed or cancelled!");
                    });
                    rzp.open();
                }
            } else {
                alert("Could not create order: " + orderData.error);
            }
        } catch (error) {
            alert("Error communicating with server.");
        } finally {
            startBtn.textContent = "Start Quiz";
            startBtn.disabled = false;
            leaderboardBtn.disabled = false;
        }
    }

    async function fetchAndStartQuiz() {
        try {
            const response = await fetch('/api/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentUser.email })
            });
            if (!response.ok) {
                const data = await response.json();
                alert(data.error || "Please complete payment");
                return;
            }
            questions = await response.json();
            if (questions.length > 0) {
                switchScreen(startScreen, quizScreen);
                startTimer();
                renderQuestion();
                updateProgress();
            } else {
                alert("Failed to load questions. Please try again.");
            }
        } catch (error) {
            alert("Error connecting to the server.");
        }
    }

    function startTimer() {
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            timeRemaining--;
            updateTimerDisplay();
            if (timeRemaining <= 0) {
                clearInterval(timerInterval);
                submitQuiz(); 
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        timeLeftEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        if (timeRemaining <= 60) {
            timeLeftEl.parentElement.style.color = '#ef4444';
            timeLeftEl.parentElement.style.background = 'rgba(239, 68, 68, 0.3)';
        }
    }

    function renderQuestion() {
        const question = questions[currentQuestionIndex];
        let html = `
            <div class="question-text">${currentQuestionIndex + 1}. ${question.text}</div>
            <div class="options-container">
        `;
        question.options.forEach((option, index) => {
            const isSelected = userAnswers[question.id] === index;
            html += `<div class="option ${isSelected ? 'selected' : ''}" data-index="${index}">${option}</div>`;
        });
        html += `</div>`;
        questionContainer.innerHTML = html;
        
        const optionEls = document.querySelectorAll('.option');
        optionEls.forEach(opt => {
            opt.addEventListener('click', () => {
                optionEls.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                userAnswers[question.id] = parseInt(opt.getAttribute('data-index'));
            });
        });
        updateFooterButtons();
    }

    function handleNextQuestion() {
        if (currentQuestionIndex < questions.length - 1) {
            currentQuestionIndex++;
            renderQuestion();
            updateProgress();
        }
    }

    function handlePrevQuestion() {
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
            renderQuestion();
            updateProgress();
        }
    }

    function updateFooterButtons() {
        prevBtn.disabled = currentQuestionIndex === 0;
        if (currentQuestionIndex === questions.length - 1) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.remove('hidden');
            submitBtn.classList.add('hidden');
        }
    }

    function updateProgress() {
        const progressPercentage = ((currentQuestionIndex + 1) / questions.length) * 100;
        progressEl.style.width = `${progressPercentage}%`;
    }

    async function submitQuiz() {
        clearInterval(timerInterval);
        try {
            submitBtn.textContent = "Submitting...";
            submitBtn.disabled = true;
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({user: currentUser, answers: userAnswers})
            });
            const result = await response.json();
            
            if (!response.ok) {
                alert(result.error || "Please complete payment");
                submitBtn.textContent = "Submit Quiz";
                submitBtn.disabled = false;
                return;
            }
            
            showResult(result);
        } catch (error) {
            alert("Error submitting the quiz.");
        } finally {
            submitBtn.textContent = "Submit Quiz";
            submitBtn.disabled = false;
        }
    }

    function showResult(result) {
        switchScreen(quizScreen, resultScreen);
        scoreValueEl.textContent = result.score;
        totalValueEl.textContent = result.total;
        const accuracy = Math.round(result.percentage);
        accuracyValueEl.textContent = `${accuracy}%`;
        scoreCircle.style.setProperty('--percentage', accuracy);
    }

    function resetQuiz() {
        currentQuestionIndex = 0;
        userAnswers = {};
        timeRemaining = TIME_LIMIT_MINUTES * 60;
        timeLeftEl.parentElement.style.color = '#fca5a5';
        timeLeftEl.parentElement.style.background = 'rgba(239, 68, 68, 0.2)';
        startForm.reset();
        switchScreen(resultScreen, startScreen);
    }

    function switchScreen(hideScreen, showScreen) {
        hideScreen.classList.remove('active');
        hideScreen.classList.add('hidden');
        showScreen.classList.remove('hidden');
        setTimeout(() => { showScreen.classList.add('active'); }, 50);
    }
});
