const socket = io({ });

// --- UI Element References ---
let statusDiv, errorDiv, initialScreen, createGameBtn, joinForm, nicknameInput, gamePinInput;
let waitingRoom, waitingTitle, hostIndicator, hostControlsDiv, gamePinDisplay, pinValueSpan;
let qrCodeContainer, quizSelectionArea, quizSelect, selectedQuizDisplay, selectedQuizNameSpan;
let playerListUl, startGameBtn, questionDisplay, questionNumberH2, timerDiv, questionTextDiv;
let optionsContainer, resultsDisplay, resultsQuestionTextH2, correctAnswerValueSpan, resultsListUl;
let nextQuestionBtn, gameOverDisplay, gameOverListUl, playAgainBtn;
let playerControlsDiv, quizPollingArea, pollOptionsContainer, hostPollResults, pollResultsList;

// --- QUIZ DATA & State Variables ---
let currentQuizData = [];
let availableQuizzes = [];
let isHost = false;
let playerId = null;
let currentGameId = null;
let questionTimerInterval = null;
let hostSocketIdFromServer = null;
let selectedQuizIdByHost = null;
let myVote = null;

// --- Utility Functions ---
function showScreen(screenId) {
     const screens = [initialScreen, waitingRoom, questionDisplay, resultsDisplay, gameOverDisplay];
     // Hide all screens first
     screens.forEach(screen => { if(screen) screen.classList.add('hidden') });

     // Show the target screen
     const screenToShow = document.getElementById(screenId);
     if (screenToShow) {
          screenToShow.classList.remove('hidden');
     } else {
          console.error("showScreen: Tried to show non-existent screen:", screenId);
     }

     if(errorDiv) errorDiv.textContent = '';

     const inGame = screenId !== 'initial-screen';
     if (nicknameInput) nicknameInput.disabled = inGame;
     if (gamePinInput) gamePinInput.disabled = inGame;
     if (joinForm && joinForm.querySelector('button')) joinForm.querySelector('button').disabled = inGame;
     if (createGameBtn) createGameBtn.disabled = inGame;

     // Control visibility based on role AND screen
     if(hostControlsDiv) {
         // Determine if the host controls should be hidden
         let shouldHideHostControls = !(isHost && screenId === 'waiting-room');
         // Toggle the 'hidden' class based on the calculation
         hostControlsDiv.classList.toggle('hidden', shouldHideHostControls);
     } else {
          console.warn("[showScreen] hostControlsDiv not found when trying to toggle visibility.");
     }

     if(playerControlsDiv) playerControlsDiv.classList.toggle('hidden', !(!isHost && screenId === 'waiting-room'));
     if(selectedQuizDisplay) selectedQuizDisplay.classList.toggle('hidden', !(!isHost && screenId === 'waiting-room' && selectedQuizIdByHost));

     // Show poll controls only in waiting room for the correct role
     if(quizPollingArea) quizPollingArea.classList.toggle('hidden', !(!isHost && screenId === 'waiting-room'));
     if(hostPollResults) hostPollResults.classList.toggle('hidden', !(isHost && screenId === 'waiting-room'));
}

function updatePlayerList(players = {}, gameStateStatus = 'waiting') {
    if(!playerListUl) { console.error("updatePlayerList: playerListUl not found"); return; }
    playerListUl.innerHTML = '';
    const sortedPlayers = Object.values(players).sort((a, b) => (b.score !== a.score) ? b.score - a.score : a.name.localeCompare(b.name));
    if (sortedPlayers.length === 0 && gameStateStatus === 'waiting') {
        playerListUl.innerHTML = '<li>No players have joined yet.</li>';
    } else {
        sortedPlayers.forEach(player => {
            const li = document.createElement('li');
            li.textContent = `${player.name} (${player.score} pts)`;
            if (gameStateStatus === 'question' && player.answered) {
                const answeredSpan = document.createElement('span');
                answeredSpan.textContent = ' ✓ Answered'; answeredSpan.className = 'answered-indicator';
                li.appendChild(answeredSpan);
            }
            playerListUl.appendChild(li);
        });
    }
}

 function startClientTimer(duration) {
     clearInterval(questionTimerInterval);
     let timeLeft = duration;
     if(!timerDiv) { console.error("startClientTimer: timerDiv not found"); return; }
     timerDiv.textContent = `Time left: ${timeLeft}s`;
     questionTimerInterval = setInterval(() => {
         timeLeft--;
         if(!timerDiv) { clearInterval(questionTimerInterval); return; }
         timerDiv.textContent = `Time left: ${timeLeft}s`;
         if (timeLeft <= 0) {
             clearInterval(questionTimerInterval);
             timerDiv.textContent = "Time's up!";
             disableAnswerButtons();
         }
     }, 1000);
 }

 function disableAnswerButtons(correctIndex = -1, playerAnswer = -1) {
     if(!optionsContainer) { console.error("disableAnswerButtons: optionsContainer not found"); return; }
     const buttons = optionsContainer.querySelectorAll('button');
     buttons.forEach((button, index) => {
         button.disabled = true; button.classList.remove('selected', 'correct', 'incorrect');
         if (correctIndex !== -1) {
             if (index === correctIndex) { button.classList.add('correct'); }
             else if (index === playerAnswer) { button.classList.add('incorrect'); }
         } else if (parseInt(button.dataset.index) === playerAnswer) { button.classList.add('selected'); }
     });
 }

 function displayQrCode(pin) {
     if(!qrCodeContainer) { console.error("displayQrCode: qrCodeContainer not found"); return; }
     qrCodeContainer.innerHTML = '';
     if (typeof qrcode !== 'undefined') {
         qrCodeContainer.classList.remove('hidden');
         try {
             const typeNumber = 4; const errorCorrectionLevel = 'L'; const qr = qrcode(typeNumber, errorCorrectionLevel);
             const joinUrl = `${window.location.origin}${window.location.pathname}?pin=${pin}`;
             qr.addData(joinUrl); qr.make(); qrCodeContainer.innerHTML = qr.createImgTag(4);
             console.log("QR Code generated for:", joinUrl);
         } catch (err) { console.error("Error generating QR Code:", err); qrCodeContainer.innerHTML = 'Error generating QR Code'; qrCodeContainer.classList.add('hidden'); }
     } else { console.warn("QR Code library (qrcode) is not loaded."); qrCodeContainer.innerHTML = 'QR Code N/A.'; qrCodeContainer.classList.add('hidden'); }
 }

 function populateQuizSelector(quizzes) { // Populates HOST dropdown
     if(!quizSelect) { console.error("populateQuizSelector: quizSelect not found"); return; }
     quizSelect.innerHTML = '<option value="" disabled selected>-- Select Quiz --</option>';
     if (quizzes && quizzes.length > 0) {
         quizzes.forEach(quiz => {
             const option = document.createElement('option'); option.value = quiz.id; option.textContent = quiz.name;
             quizSelect.appendChild(option);
         });
         quizSelect.disabled = false;
     } else {
         const option = document.createElement('option'); option.value = ""; option.textContent = "No quizzes available"; option.disabled = true;
         quizSelect.appendChild(option); quizSelect.disabled = true;
     }
 }

 // Display Quiz Poll Buttons (Player) or Results (Host)
 function displayQuizPoll(currentVote, voteCounts = {}) {
     // Player View: Voting Buttons
     if (!isHost && quizPollingArea && pollOptionsContainer) {
         pollOptionsContainer.innerHTML = ''; // Clear previous buttons
         if (availableQuizzes.length > 0) {
             quizPollingArea.classList.remove('hidden');
             availableQuizzes.forEach(quiz => {
                 const button = document.createElement('button');
                 button.textContent = quiz.name;
                 button.dataset.quizId = quiz.id;
                 button.classList.add('poll-option-button');
                 if (quiz.id === currentVote) { button.classList.add('voted-for'); }
                 button.onclick = () => {
                     console.log(`Player clicked vote for: ${quiz.id}`);
                     socket.emit('player:voteForQuiz', quiz.id);
                     document.querySelectorAll('.poll-option-button.voted-for').forEach(btn => btn.classList.remove('voted-for'));
                     button.classList.add('voted-for');
                     myVote = quiz.id;
                 };
                 pollOptionsContainer.appendChild(button);
             });
         } else { quizPollingArea.classList.add('hidden'); }
     } else if (!isHost) { console.error("displayQuizPoll: Player poll elements not found"); }

     // Host View: Vote Counts
     if (isHost && hostPollResults && pollResultsList) {
         pollResultsList.innerHTML = ''; // Clear previous results
         if (availableQuizzes.length > 0) {
              hostPollResults.classList.remove('hidden');
              availableQuizzes.forEach(quiz => {
                  const count = voteCounts[quiz.id] || 0;
                  const div = document.createElement('div');
                  div.textContent = `${quiz.name}: `;
                  const countSpan = document.createElement('span');
                  countSpan.className = 'vote-count';
                  countSpan.textContent = `${count} vote${count !== 1 ? 's' : ''}`;
                  div.appendChild(countSpan);
                  pollResultsList.appendChild(div);
              });
         } else { hostPollResults.classList.add('hidden'); }
     } else if (isHost) { console.error("displayQuizPoll: Host poll elements not found"); }
 }

 function resetClientState() {
     isHost = false; playerId = null; currentGameId = null; hostSocketIdFromServer = null;
     selectedQuizIdByHost = null; currentQuizData = []; availableQuizzes = []; myVote = null;
     clearInterval(questionTimerInterval);
     if(timerDiv) timerDiv.textContent = '';
     if(nicknameInput) nicknameInput.value = '';
     if(gamePinInput) gamePinInput.value = '';
     if(pinValueSpan) pinValueSpan.textContent = '';
     if(hostIndicator) hostIndicator.textContent = '';
     if(playerListUl) playerListUl.innerHTML = '';
     if(optionsContainer) optionsContainer.innerHTML = '';
     if(resultsListUl) resultsListUl.innerHTML = '';
     if(gameOverListUl) gameOverListUl.innerHTML = '';
     if(hostControlsDiv) hostControlsDiv.classList.add('hidden');
     if(playerControlsDiv) playerControlsDiv.classList.add('hidden');
     // if(gamePinDisplay) gamePinDisplay.classList.add('hidden'); // Parent controls this
     if(qrCodeContainer) { qrCodeContainer.innerHTML = ''; qrCodeContainer.classList.add('hidden'); }
     if(quizSelect) { quizSelect.innerHTML = '<option value="" disabled selected>-- Select Quiz --</option>'; quizSelect.value = ''; quizSelect.disabled = false; }
     if(selectedQuizDisplay) selectedQuizDisplay.classList.add('hidden');
     if(selectedQuizNameSpan) selectedQuizNameSpan.textContent = '';
     if(quizPollingArea) quizPollingArea.classList.add('hidden');
     if(pollOptionsContainer) pollOptionsContainer.innerHTML = '';
     if(hostPollResults) hostPollResults.classList.add('hidden');
     if(pollResultsList) pollResultsList.innerHTML = '';
     [startGameBtn, nextQuestionBtn, playAgainBtn].forEach(btn => { if(btn) { btn.classList.add('hidden'); btn.disabled = true; }});
     if(createGameBtn) createGameBtn.disabled = false;
     if(joinForm && joinForm.querySelector('button')) joinForm.querySelector('button').disabled = false;
     if(nicknameInput) nicknameInput.disabled = false;
     if(gamePinInput) gamePinInput.disabled = false;
 }

 function handleAnswerClick(event) {
      if (isHost || !currentGameId) {
           console.warn("handleAnswerClick ignored: Client is host or not in a game.");
           return;
      }
      const selectedButton = event.currentTarget;
      if (!selectedButton || typeof selectedButton.dataset?.index === 'undefined') {
           console.warn("handleAnswerClick ignored: Invalid event target or missing data-index.");
           return;
      }
      const answerIndex = parseInt(selectedButton.dataset.index);

      disableAnswerButtons(-1, answerIndex); // Highlight selected, disable all

      socket.emit('player:answer', answerIndex);
 }

 // --- Attach Socket Event Handlers ---
 socket.on('connect', () => {
     if(statusDiv) statusDiv.textContent = 'Connected';
     if(statusDiv) statusDiv.style.color = 'green';
 });
 socket.on('disconnect', (reason) => {
     if(statusDiv) statusDiv.textContent = `Disconnected: ${reason}`;
     if(statusDiv) statusDiv.style.color = 'red';
     if(errorDiv) errorDiv.textContent = 'Connection lost. Please refresh or rejoin.';
     // resetClientState(); showScreen('initial-screen'); // Dont reset fully on disconnect
 });
 socket.on('connect_error', (err) => {
     if(statusDiv) statusDiv.textContent = `Connection Failed`; if(statusDiv) statusDiv.style.color = 'red';
     resetClientState(); showScreen('initial-screen'); // Reset fully on connection error
     if(errorDiv) errorDiv.textContent = `Could not connect. (${err.message})`;
 });
 socket.on('error', (message) => {
      // Re-enable buttons if the error occurred during an action
      if (initialScreen && !initialScreen.classList.contains('hidden')) {
          if(createGameBtn) createGameBtn.disabled = false; if(joinForm && joinForm.querySelector('button')) joinForm.querySelector('button').disabled = false;
          if(nicknameInput) nicknameInput.disabled = false; if(gamePinInput) gamePinInput.disabled = false;
      }
      if (isHost) {
         if(startGameBtn && !startGameBtn.classList.contains('hidden')) startGameBtn.disabled = false;
         if(nextQuestionBtn && !nextQuestionBtn.classList.contains('hidden')) nextQuestionBtn.disabled = false;
         if(playAgainBtn && !playAgainBtn.classList.contains('hidden')) playAgainBtn.disabled = false;
      }
 });
 socket.on('gameCreated', (data) => {
      isHost = true; // Set role before calling showScreen
      playerId = data.hostId;
      currentGameId = data.gameId; // This is the PIN
      hostSocketIdFromServer = data.hostId;
      availableQuizzes = data.availableQuizzes || [];

      if(pinValueSpan) {
          pinValueSpan.textContent = currentGameId; // Set the PIN value
          console.log(`PIN displayed: ${currentGameId}`);
      }

      displayQrCode(currentGameId); // Generate QR code using the PIN
      populateQuizSelector(availableQuizzes);
      if(hostIndicator) hostIndicator.textContent = '(You are the Host)';
      showScreen('waiting-room'); // Now call showScreen, which uses the updated isHost value
      displayQuizPoll(null, {}); // Show initial host poll results
 });
 socket.on('joined', (data) => {
       isHost = false; // Set role before calling showScreen
       playerId = data.playerId;
       currentGameId = data.gameId;
       selectedQuizIdByHost = data.selectedQuizId;
       availableQuizzes = data.availableQuizzes || [];
       myVote = data.myVote || null; // Get player's current vote
       const selectedQuizName = data.selectedQuizName || 'Not selected yet';

       if(startGameBtn) startGameBtn.classList.add('hidden');
       if(nextQuestionBtn) nextQuestionBtn.classList.add('hidden');
       if(playAgainBtn) playAgainBtn.classList.add('hidden');
       // hostControlsDiv visibility is handled by showScreen now

       if(hostIndicator) hostIndicator.textContent = '';
       if(selectedQuizNameSpan) selectedQuizNameSpan.textContent = selectedQuizName;
       // selectedQuizDisplay visibility is handled by showScreen

       showScreen('waiting-room'); // Now call showScreen
       displayQuizPoll(myVote, data.quizVotes); // Show player poll
 });
 socket.on('hostDisconnected', () => { console.warn('Host Disconnected'); if (!isHost) { alert('Host disconnected.'); } resetClientState(); showScreen('initial-screen'); });
 socket.on('gameReset', () => {
      selectedQuizIdByHost = null; currentQuizData = []; myVote = null;
      showScreen('waiting-room'); // Show waiting room again
      clearInterval(questionTimerInterval);
      if(timerDiv) timerDiv.textContent = '';
      if(optionsContainer) optionsContainer.innerHTML = '';
      if(resultsListUl) resultsListUl.innerHTML = '';
      if(gameOverListUl) gameOverListUl.innerHTML = '';
      if(errorDiv) errorDiv.textContent = isHost ? 'Game reset. Select quiz.' : 'Host reset game.';
      if (isHost) {
           if(quizSelect) quizSelect.value = '';
           if(startGameBtn) startGameBtn.disabled = true; // Start disabled until quiz selected
           displayQuizPoll(null, {}); // Reset poll counts view
      } else {
          if(selectedQuizNameSpan) selectedQuizNameSpan.textContent = 'Not selected yet';
          displayQuizPoll(null, {}); // Reset voting buttons view
      }
      if(nextQuestionBtn) nextQuestionBtn.classList.add('hidden');
      if(playAgainBtn) playAgainBtn.classList.add('hidden');
 });
 socket.on('updateGameState', (state) => {
      if (!state || state.gameId !== currentGameId) return; // Ignore updates for wrong game

      // Update core state variables
      let wasHost = isHost;
      hostSocketIdFromServer = state.hostSocketId;
      selectedQuizIdByHost = state.selectedQuizId;
      isHost = (playerId === hostSocketIdFromServer); // Recalculate role just in case
      myVote = state.players[playerId]?.votedForQuizId || null; // Update vote status
      availableQuizzes = state.availableQuizzes || []; // Keep available quizzes updated

      updatePlayerList(state.players, state.status);

      const hasPlayers = Object.values(state.players).length > 0;
      const quizSelectedByHost = !!selectedQuizIdByHost;
      const canStart = isHost && state.status === 'waiting' && hasPlayers && quizSelectedByHost;
      if(startGameBtn) {
          // Show start button ONLY if host AND in waiting state
          startGameBtn.classList.toggle('hidden', !(isHost && state.status === 'waiting'));
          startGameBtn.disabled = !canStart;
      }

      const canShowNext = isHost && state.status === 'results';
      if(nextQuestionBtn) {
          nextQuestionBtn.classList.toggle('hidden', !canShowNext);
          nextQuestionBtn.disabled = !canShowNext;
      }

      const canShowPlayAgain = isHost && state.status === 'gameOver';
      if(playAgainBtn) {
          playAgainBtn.classList.toggle('hidden', !canShowPlayAgain);
          playAgainBtn.disabled = !canShowPlayAgain;
      }

      // Update dynamic text elements in waiting room
      const selectedQuizName = state.selectedQuizName || 'Not selected yet';
      if(selectedQuizNameSpan) selectedQuizNameSpan.textContent = selectedQuizName;

      // Update visibility of specific sections within the current screen
      if (state.status === 'waiting') {
          if(hostControlsDiv) hostControlsDiv.classList.toggle('hidden', !isHost);
          if(playerControlsDiv) playerControlsDiv.classList.toggle('hidden', isHost);
          if(selectedQuizDisplay) selectedQuizDisplay.classList.toggle('hidden', !(!isHost && selectedQuizIdByHost));
          displayQuizPoll(myVote, state.quizVotes); // Update poll view

          // Update Waiting Title
          if(hostIndicator) hostIndicator.textContent = isHost ? '(You are the Host)' : '';
          if(waitingTitle) {
              if (isHost) {
                  let waitingMsg = 'Waiting for players...';
                  if (!hasPlayers) waitingMsg += ' (Need ≥1!)';
                  if (!quizSelectedByHost) waitingMsg += (hasPlayers ? ' Select final quiz!' : ' & select final quiz!');
                  waitingTitle.textContent = waitingMsg;
              } else {
                  waitingTitle.textContent = `Waiting for Host to start...`;
              }
          }
      } else {
          // Hide waiting room specific elements if not in waiting state
          if(quizPollingArea) quizPollingArea.classList.add('hidden');
          if(hostPollResults) hostPollResults.classList.add('hidden');
      }
 });
 socket.on('showQuestion', (question) => {
      if (!question || typeof question.index !== 'number' || !question.text || !Array.isArray(question.options)) {
          console.error("Invalid question data received:", question);
          if(errorDiv) errorDiv.textContent = "Error receiving question data.";
          return;
      }
      if (question.gameId !== currentGameId) {
          console.log("Ignoring showQuestion for wrong/old game ID.");
          return;
      }
      if (Array.isArray(question.fullQuizData)) {
          currentQuizData = question.fullQuizData;
          console.log("Received and stored full quiz data:", currentQuizData);
      }

      if(!questionNumberH2 || !questionTextDiv || !optionsContainer || !timerDiv) {
          console.error("showQuestion ERROR: Core question display elements not found!");
          if(errorDiv) errorDiv.textContent = "UI Error: Cannot display question.";
          return;
      }

      showScreen('question-display');
      questionNumberH2.textContent = `Question ${question.index + 1}`;
      questionTextDiv.textContent = question.text;
      optionsContainer.innerHTML = ''; // Clear previous options

      console.log(`showQuestion: Populating options. isHost = ${isHost}`);

      question.options.forEach((option, index) => {
          const button = document.createElement('button');
          button.textContent = option;
          button.dataset.index = index;
          button.disabled = isHost; // Host cannot answer

          if (!isHost) {
              button.addEventListener('click', handleAnswerClick);
          }
          optionsContainer.appendChild(button);
      });

      startClientTimer(question.duration);
      if(nextQuestionBtn) nextQuestionBtn.classList.add('hidden');
      if(playAgainBtn) playAgainBtn.classList.add('hidden');
 });

 socket.on('showResults', (results) => {
       if (!results || typeof results.questionIndex !== 'number') { console.error("Invalid results data:", results); return; }
       if (results.gameId !== currentGameId) return; // Ignore results for wrong game

      showScreen('results-display');
      clearInterval(questionTimerInterval); if(timerDiv) timerDiv.textContent = '';

      const questionInfo = currentQuizData[results.questionIndex];
      if (!questionInfo) { console.error(`No mirrored data for index ${results.questionIndex}`); if(errorDiv) errorDiv.textContent = "Error showing results (missing question data)."; return; }

      if(resultsQuestionTextH2) resultsQuestionTextH2.textContent = `Results for: "${questionInfo.question}"`;
      const correctAnswerIndex = results.correctAnswer;
      const correctAnswerText = (correctAnswerIndex >= 0 && questionInfo.options && correctAnswerIndex < questionInfo.options.length) ? questionInfo.options[correctAnswerIndex] : 'Invalid Answer Index';
      if(correctAnswerValueSpan) correctAnswerValueSpan.textContent = correctAnswerText;

      if(resultsListUl) resultsListUl.innerHTML = '';
      const sortedScores = Object.entries(results.scores).sort(([, a], [, b]) => b.score - a.score);
      let playerAnswerForHighlight = -1;

      if (resultsListUl) {
          if (sortedScores.length === 0) { resultsListUl.innerHTML = '<li>No player scores.</li>'; }
          else {
              sortedScores.forEach(([pId, data]) => {
                  const li = document.createElement('li');
                  const nameScoreSpan = document.createElement('span');
                  nameScoreSpan.textContent = `${data.name}: ${data.score} pts`;
                  const answerInfoSpan = document.createElement('span');
                  answerInfoSpan.className = 'player-answer';

                  if (pId === playerId) {
                      playerAnswerForHighlight = (typeof data.answer === 'number') ? data.answer : -1;
                  }

                  const answerText = (typeof data.answer === 'number' && questionInfo.options && data.answer >= 0 && data.answer < questionInfo.options.length) ? questionInfo.options[data.answer] : 'Invalid Answer';

                  if (data.answered && typeof data.answer === 'number') {
                      answerInfoSpan.textContent = ` Answered: ${answerText}`;
                      answerInfoSpan.classList.toggle('correct', data.isCorrect);
                      answerInfoSpan.classList.toggle('incorrect', !data.isCorrect);
                  } else {
                      answerInfoSpan.textContent = ` Didn't answer`;
                      answerInfoSpan.classList.add('no-answer');
                  }
                  li.appendChild(nameScoreSpan);
                  li.appendChild(answerInfoSpan);
                  resultsListUl.appendChild(li);
              });
          }
      }
      // Disable and highlight buttons based on correctness after iterating scores
      disableAnswerButtons(correctAnswerIndex, playerAnswerForHighlight);
 });
 socket.on('gameOver', (data) => {
       if (!data || !Array.isArray(data.scores)) { console.error("Invalid game over data:", data); return; }
       if (data.gameId !== currentGameId) return; // Ignore game over for wrong game

      showScreen('game-over-display');
      clearInterval(questionTimerInterval); if(timerDiv) timerDiv.textContent = '';
      currentQuizData = []; // Clear quiz data

      if(gameOverListUl) gameOverListUl.innerHTML = '';
      if(gameOverListUl) {
          if (data.scores.length === 0) { gameOverListUl.innerHTML = '<li>No final scores.</li>'; }
          else {
              data.scores.forEach((player, index) => {
                   const li = document.createElement('li');
                   let rank = `#${index + 1}`;
                   if (index === 0) rank = '🥇 ' + rank;
                   else if (index === 1) rank = '🥈 ' + rank;
                   else if (index === 2) rank = '🥉 ' + rank;
                   li.textContent = `${rank}: ${player.name} - ${player.score} points`;
                   gameOverListUl.appendChild(li);
               });
          }
      }
      if(nextQuestionBtn) nextQuestionBtn.classList.add('hidden');
 });


// --- Wait for DOM, then Initialize UI and Apply PIN ---
document.addEventListener('DOMContentLoaded', () => {

    // --- Assign UI Element References NOW ---
    statusDiv = document.getElementById('status'); errorDiv = document.getElementById('error-message'); initialScreen = document.getElementById('initial-screen'); createGameBtn = document.getElementById('create-game-btn'); joinForm = document.getElementById('join-form'); nicknameInput = document.getElementById('nickname-input'); gamePinInput = document.getElementById('game-pin-input'); waitingRoom = document.getElementById('waiting-room'); waitingTitle = document.getElementById('waiting-title'); hostIndicator = document.getElementById('host-indicator'); hostControlsDiv = document.getElementById('host-controls'); playerControlsDiv = document.getElementById('player-controls');
    gamePinDisplay = document.getElementById('game-pin-display');
    pinValueSpan = document.getElementById('pin-value');
    qrCodeContainer = document.getElementById('qr-code-container'); quizSelectionArea = document.getElementById('quiz-selection-area'); quizSelect = document.getElementById('quiz-select'); selectedQuizDisplay = document.getElementById('selected-quiz-display'); selectedQuizNameSpan = document.getElementById('selected-quiz-name'); quizPollingArea = document.getElementById('quiz-polling-area'); pollOptionsContainer = document.getElementById('poll-options-container'); hostPollResults = document.getElementById('host-poll-results'); pollResultsList = document.getElementById('poll-results-list'); playerListUl = document.querySelector('#player-list ul'); startGameBtn = document.getElementById('start-game-btn'); questionDisplay = document.getElementById('question-display'); questionNumberH2 = document.getElementById('question-number'); timerDiv = document.getElementById('timer'); questionTextDiv = document.getElementById('question-text'); optionsContainer = document.getElementById('options-container'); resultsDisplay = document.getElementById('results-display'); resultsQuestionTextH2 = document.getElementById('results-question-text'); correctAnswerValueSpan = document.getElementById('correct-answer-value'); resultsListUl = document.querySelector('#results-list ul'); nextQuestionBtn = document.getElementById('next-question-btn'); gameOverDisplay = document.getElementById('game-over-display'); gameOverListUl = document.querySelector('#game-over-list ul'); playAgainBtn = document.getElementById('play-again-btn');

    // --- Check for PIN in URL ---
    const urlParams = new URLSearchParams(window.location.search);
    const pin = urlParams.get('pin');
    let pinToApply = null;

    if (pin && /^\d{6}$/.test(pin)) {
        console.log("PIN found in URL:", pin);
        pinToApply = pin;
         // Clean the URL immediately after reading the PIN
         window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
         console.log("Cleaned PIN from URL.");
    } else if (pin) { console.log("PIN found in URL, but invalid:", pin); }
    else { console.log("No PIN found in URL."); }

    // --- Initial UI Setup ---
    resetClientState();
    showScreen('initial-screen');

    // --- Apply PIN AFTER Reset and Show ---
    if (pinToApply) {
        console.log("Applying PIN from URL after init:", pinToApply);
        if (gamePinInput) { gamePinInput.value = pinToApply; console.log("Successfully applied PIN to input."); }
        else { console.error("gamePinInput element was NULL when applying PIN!"); }
    } else { console.log("No valid PIN to apply after init."); }

    // --- Create Game Button ---
    if (createGameBtn) {
        createGameBtn.addEventListener('click', () => {
            // Clear any previous error messages
            if (errorDiv) errorDiv.textContent = '';

            // Disable buttons to prevent multiple actions
            createGameBtn.disabled = true;
            const joinButton = joinForm ? joinForm.querySelector('button') : null;
            if (joinButton) {
                joinButton.disabled = true;
            }

            // Signal the server to create a new game
            socket.emit('host:createGame');
        });
    }

    // --- Join Game Form ---
    if (joinForm) {
        joinForm.addEventListener('submit', (e) => {
            e.preventDefault(); // Prevent default form submission behavior

            // Clear any previous error messages
            if (errorDiv) errorDiv.textContent = '';

            // Get nickname and game ID from input fields, trimming whitespace
            const nickname = nicknameInput ? nicknameInput.value.trim() : '';
            const gameId = gamePinInput ? gamePinInput.value.trim() : '';

            // Validate nickname input
            if (!nickname) {
                if (errorDiv) errorDiv.textContent = 'Please enter a nickname.';
                return; // Stop processing if validation fails
            }

            // Validate game ID input (must be exactly 6 digits)
            if (!gameId || !/^\d{6}$/.test(gameId)) {
                if (errorDiv) errorDiv.textContent = 'Please enter a valid 6-digit game PIN.';
                return; // Stop processing if validation fails
            }

            // Disable inputs and buttons to prevent multiple submissions
            if (nicknameInput) nicknameInput.disabled = true;
            if (gamePinInput) gamePinInput.disabled = true;
            const joinButton = joinForm.querySelector('button');
            if (joinButton) joinButton.disabled = true;
            if (createGameBtn) createGameBtn.disabled = true; // Also disable create game button

            // Signal the server that a player wants to join
            socket.emit('player:join', { nickname, gameId }); // Use object shorthand
        });
    }

    // --- Quiz Selection Dropdown ---
    if (quizSelect) {
        quizSelect.addEventListener('change', () => {
            const selectedId = quizSelect.value;

            // Check if a valid quiz is selected, a game is active, and the user is the host
            if (selectedId && currentGameId && isHost) {
                 // Clear any previous error messages upon valid selection
                if (errorDiv) errorDiv.textContent = '';
                // Signal the server about the host's quiz selection
                socket.emit('host:selectQuiz', selectedId);
            }
        });
    }

    // --- Start Game Button ---
    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            // Clear any previous error messages
            if (errorDiv) errorDiv.textContent = '';

            // Ensure a quiz has been selected before starting
            if (!selectedQuizIdByHost) {
                if (errorDiv) errorDiv.textContent = "Please select a quiz first.";
                return; // Stop processing if no quiz is selected
            }

            // Disable the button to prevent multiple clicks
            startGameBtn.disabled = true;

            // Signal the server to start the game
            socket.emit('host:startGame');
        });
    }

    // --- Next Question Button ---
    if (nextQuestionBtn) {
        nextQuestionBtn.addEventListener('click', () => {
            // Clear any previous error messages
            if (errorDiv) errorDiv.textContent = '';

            // Disable the button to prevent multiple clicks
            nextQuestionBtn.disabled = true;

            // Signal the server to proceed to the next question
            socket.emit('host:nextQuestion');
        });
    }

    // --- Play Again Button ---
    if (playAgainBtn) {
        playAgainBtn.addEventListener('click', () => {
             // Clear any previous error messages
            if (errorDiv) errorDiv.textContent = '';

            // Disable the button to prevent multiple clicks
            playAgainBtn.disabled = true;

            // Signal the server to reset the game for another round
            socket.emit('host:resetGame');
        });
    }
});