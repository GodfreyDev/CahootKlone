const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// --- Configuration ---
const allowedOrigins = [
  "http://localhost:3000",         /////////////////////////////////////////////
  "https://cahootklone.glitch.me" // MAKE SURE this matches Glitch project name
];                               /////////////////////////////////////////////

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) { callback(null, true); }
      else { console.warn(`[CORS Blocked] Origin: ${origin}`); callback(new Error(`Origin ${origin} not allowed by CORS`)); }
    },
    methods: ["GET", "POST"],
  },
});

// --- Game Data ---
let quizzes = {}; // Initialize empty

function loadQuizzes() {
    try {
        const quizFilePath = path.resolve(__dirname, 'quizzes.json');
        console.log(`[Server Startup] Attempting to load quizzes from: ${quizFilePath}`);
        if (fs.existsSync(quizFilePath)) {
            const rawData = fs.readFileSync(quizFilePath);
            quizzes = JSON.parse(rawData);
            console.log(`[Server Startup] Successfully loaded ${Object.keys(quizzes).length} quizzes from quizzes.json`);
            // Basic validation
            for (const quizId in quizzes) {
                if (!quizzes[quizId].name || !Array.isArray(quizzes[quizId].data)) {
                    console.error(`[Quiz Load Error] Invalid structure for quiz ID: ${quizId}`);
                    delete quizzes[quizId]; // Remove invalid quiz
                } else {
                    // Add question count for convenience if not already present (though getAvailableQuizzesForClient calculates it too)
                    quizzes[quizId].questionCount = quizzes[quizId].data.length;
                }
            }
        } else {
            console.warn(`[Server Startup] quizzes.json not found at ${quizFilePath}. Using empty quiz list.`);
            quizzes = {};
        }
    } catch (error) {
        console.error("[Server Startup] Error loading or parsing quizzes.json:", error);
        quizzes = {}; // Default to empty on error
    }
}
loadQuizzes(); // Load quizzes when server starts

function getAvailableQuizzesForClient() {
    if (!quizzes || Object.keys(quizzes).length === 0) {
        return []; // Return empty array if no quizzes loaded
    }
    return Object.entries(quizzes).map(([id, details]) => {
        // Ensure details and data exist before accessing length
        const questionCount = (details && details.data && Array.isArray(details.data)) ? details.data.length : 0;
        return {
            id: id,
            name: details.name || `Unnamed Quiz (${id})`, // Provide default name if missing
            questionCount: questionCount
        };
    });
}

// --- Game State Management ---
const activeGames = new Map();

function createNewGameState(hostId) {
  return {
    gameId: null,
    hostSocketId: hostId,
    status: "waiting",
    selectedQuizId: null, // Host's final selection
    selectedQuizName: null,
    players: {}, // { socketId: { name: 'PlayerName', score: 0, answered: false, votedForQuizId: null } }
    quizVotes: {}, // { quizId: count }
    currentQuestionIndex: -1,
    questionTimer: null, // Stores the NodeJS Timeout object reference
    playerAnswers: {},
  };
}

function generateGameId() {
  let gameId;
  do {
    gameId = Math.floor(100000 + Math.random() * 900000).toString();
  } while (activeGames.has(gameId));
  return gameId;
}

// --- Serve Static Files & Libraries ---
const qrcodePath = path.resolve(__dirname, 'node_modules/qrcode-generator/qrcode.js');
console.log(`[Server Startup] Expected path for qrcode.js: ${qrcodePath}`);

// Serve qrcode.js
app.get('/qrcode.js', (req, res, next) => {
  console.log("--> Request received for /qrcode.js");
  fs.access(qrcodePath, fs.constants.R_OK, (err) => {
      if (err) {
          console.error(`--> !!! Error accessing qrcode.js at resolved path ${qrcodePath}:`, err);
          res.status(500).send(`Internal Server Error: QR Code library (${qrcodePath}) not found or readable on server.`);
      } else {
          console.log(`--> Attempting to serve qrcode.js from: ${qrcodePath}`);
          res.sendFile(qrcodePath, (sendErr) => {
              if (sendErr) {
                  console.error("--> !!! Error sending qrcode.js:", sendErr);
                  if (!res.headersSent) { next(sendErr); }
              } else { console.log("--> Served qrcode.js successfully."); }
          });
      }
  });
});

// Serve index.html for root requests
app.get("/", (req, res) => {
    console.log("--> Request received for / (Root Route)");
    const indexPath = path.join(__dirname, "public", "index.html");
     fs.access(indexPath, fs.constants.R_OK, (err) => {
         if(err){
              console.error("--> !!! Error accessing index.html:", err);
              res.status(500).send("Cannot find main application file.");
         } else { res.sendFile(indexPath); }
     });
  });

// Serve other static files from public
app.use(express.static(path.join(__dirname, "public")));
console.log(`[Server Startup] Serving static files from: ${path.join(__dirname, "public")}`);

// --- Socket.IO Connection Logic ---
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.data.gameId = null;

  // --- Host Actions ---
  socket.on("host:createGame", () => {
    if (socket.data.gameId && activeGames.has(socket.data.gameId)) { socket.emit("error", "You are already in a game."); return; }
    const gameId = generateGameId(); const newGame = createNewGameState(socket.id);
    newGame.gameId = gameId; activeGames.set(gameId, newGame);
    socket.data.gameId = gameId; socket.join(gameId);
    console.log(`Host ${socket.id} created Game Room: ${gameId}`);
    socket.emit("gameCreated", { gameId: gameId, hostId: socket.id, availableQuizzes: getAvailableQuizzesForClient() });
    io.to(gameId).emit("updateGameState", getSanitizedGameState(newGame));
  });

   socket.on("host:selectQuiz", (quizId) => { // Host's Final Selection
       const gameId = socket.data.gameId; const game = activeGames.get(gameId);
       if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can select a quiz."); return; }
       if (game.status !== "waiting") { socket.emit("error", "Cannot change quiz after the game has started."); return; }
       if (!quizzes || !quizzes[quizId]) { socket.emit("error", "Selected quiz not found/loaded."); return; } // Check loaded quizzes
       game.selectedQuizId = quizId; game.selectedQuizName = quizzes[quizId].name;
       console.log(`Game ${gameId}: Host FINALIZED selection to '${game.selectedQuizName}' (ID: ${quizId})`);
       io.to(gameId).emit("updateGameState", getSanitizedGameState(game)); // Update state with final choice
   });

  socket.on("host:startGame", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can start the game."); return; }
    if (game.status !== "waiting") { socket.emit("error", "Game is not in a waiting state."); return; }
     if (!game.selectedQuizId) { socket.emit("error", "Please select a quiz before starting."); return; }
     if (!quizzes || !quizzes[game.selectedQuizId]) { socket.emit("error", "Selected quiz data is not available."); return; } // Check quiz exists
     const playerIds = Object.keys(game.players);
     if (playerIds.length === 0) { socket.emit("error", "Need at least one player to start."); return; }
    console.log(`Game ${gameId} starting with quiz '${game.selectedQuizName}'...`);
    game.status = "question"; game.currentQuestionIndex = -1; clearTimeout(game.questionTimer); game.questionTimer = null; // Ensure timer cleared
    nextQuestion(gameId);
  });

  socket.on("host:nextQuestion", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can advance the question."); return; }
    if (game.status === "results") { // Only advance from results screen
        console.log(`G:${gameId} - Host manually triggered nextQuestion.`);
        clearTimeout(game.questionTimer); game.questionTimer = null; // Clear any pending timer
        nextQuestion(gameId);
    } else { socket.emit("error", "Can only advance to next question from results screen."); }
  });

  // --- Player Actions ---
  socket.on("player:join", ({ nickname, gameId }) => {
    if (!nickname || !gameId) { socket.emit("error", "Nickname and Game PIN are required."); return; }
    if (socket.data.gameId && activeGames.has(socket.data.gameId)) { socket.emit("error", "You are already in a game."); return; }
    const game = activeGames.get(gameId); if (!game) { socket.emit("error", `Game with PIN ${gameId} not found.`); return; }
    if (game.status !== "waiting") { socket.emit("error", "This game has already started or finished."); return; }
    const trimmedNickname = nickname.trim(); if (trimmedNickname.length === 0 || trimmedNickname.length > 20) { socket.emit("error", "Nickname must be between 1 and 20 characters."); return; }
    const nameExists = Object.values(game.players).some(p => p.name.toLowerCase() === trimmedNickname.toLowerCase()); if (nameExists) { socket.emit("error", `Nickname '${trimmedNickname}' is already taken in this game.`); return; }
    console.log(`Player ${trimmedNickname} (${socket.id}) joining Game ${gameId}`);
    game.players[socket.id] = { name: trimmedNickname, score: 0, answered: false, votedForQuizId: null };
    socket.data.gameId = gameId; socket.join(gameId);
    socket.emit("joined", { playerId: socket.id, name: trimmedNickname, gameId: gameId, selectedQuizId: game.selectedQuizId, selectedQuizName: game.selectedQuizName, availableQuizzes: getAvailableQuizzesForClient(), quizVotes: game.quizVotes, myVote: null });
    io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
  });

  socket.on("player:voteForQuiz", (quizId) => {
      const gameId = socket.data.gameId; const game = activeGames.get(gameId);
      if (!game || !game.players[socket.id] || socket.id === game.hostSocketId) { return; }
      if (game.status !== "waiting") { return; }
      if (!quizzes || !quizzes[quizId]) { socket.emit("error", "Invalid quiz voted for."); return; }
      const playerState = game.players[socket.id]; const previousVote = playerState.votedForQuizId;
      console.log(`Player ${playerState.name} votes for ${quizId} (previously: ${previousVote}) in game ${gameId}`);
      if (previousVote && previousVote !== quizId && game.quizVotes[previousVote] > 0) { game.quizVotes[previousVote]--; }
      if (previousVote !== quizId) { game.quizVotes[quizId] = (game.quizVotes[quizId] || 0) + 1; }
      playerState.votedForQuizId = quizId;
      io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
  });

  socket.on("player:answer", (answerIndex) => {
    console.log(`>>> SERVER received player:answer from ${socket.id} with index: ${answerIndex}`);
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);

    // --- Validations ---
    if (!game || !game.players[socket.id] || socket.id === game.hostSocketId) { console.warn("Answer rejected (A1): Invalid game/player/host."); return; }
    if (game.status !== "question") { console.warn(`Answer rejected (A2): Game status is ${game.status}, not 'question'.`); return; }
    if (!quizzes || !game.selectedQuizId || !quizzes[game.selectedQuizId]) { console.error("Answer rejected (A3): Selected quiz data missing."); return; }
    const selectedQuizData = quizzes[game.selectedQuizId].data;
    if (game.currentQuestionIndex < 0 || game.currentQuestionIndex >= selectedQuizData.length) { console.error("Answer rejected (A4): Invalid question index."); return; }
    const currentQuestion = selectedQuizData[game.currentQuestionIndex];
    if (typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex >= currentQuestion.options.length) { console.warn(`Answer rejected (A5): Invalid answer index ${answerIndex}.`); socket.emit("error", "Invalid answer submitted."); return; }
    if (game.players[socket.id].answered) { console.log(`Answer rejected (A6): Player ${socket.id} already answered.`); return; }
    // --- End Validations ---

    console.log(`G:${gameId} Q:${game.currentQuestionIndex} - Player ${game.players[socket.id].name} (${socket.id}) answered: ${answerIndex}.`);
    game.players[socket.id].answered = true;
    game.playerAnswers[socket.id] = answerIndex;

    // --- Check if all players have answered ---
    const activePlayerIds = Object.keys(game.players);
    let allAnswered = false;
    if (activePlayerIds.length > 0) {
        let answeredCount = 0;
        activePlayerIds.forEach(pid => {
            if (game.players[pid]?.answered) {
                answeredCount++;
            }
        });
        allAnswered = (answeredCount === activePlayerIds.length);
        console.log(`G:${gameId} Q:${game.currentQuestionIndex} - Answer Count Check: TotalPlayers: ${activePlayerIds.length}, Answered: ${answeredCount}, AllAnswered: ${allAnswered}`);
    } else {
        console.log(`G:${gameId} Q:${game.currentQuestionIndex} - Answer Count Check: No active players found.`);
    }
    // --- End Check ---

    if (allAnswered) {
      console.log(`✅ G:${gameId} Q:${game.currentQuestionIndex} - All players answered. Clearing timer (${game.questionTimer}) and calling showResults.`);
      clearTimeout(game.questionTimer); game.questionTimer = null;
      showResults(gameId); // Go to results
    } else {
      console.log(`⏳ G:${gameId} Q:${game.currentQuestionIndex} - Not all answered. Sending state update only.`);
      io.to(gameId).emit("updateGameState", getSanitizedGameState(game)); // Show progress
    }
  });

  // --- Disconnection Handling ---
  socket.on("disconnect", (reason) => {
     console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);
    const gameId = socket.data.gameId;
    if (gameId && activeGames.has(gameId)) {
      const game = activeGames.get(gameId);
      if (socket.id === game.hostSocketId) {
        console.log(`Host ${socket.id} disconnected from game ${gameId}. Ending game.`);
        io.to(gameId).emit("hostDisconnected"); cleanupGame(gameId);
      }
      else if (game.players[socket.id]) {
        const playerState = game.players[socket.id]; const playerName = playerState.name;
        const voteToRemove = playerState.votedForQuizId; const wasAnswered = playerState.answered;
        console.log(`Player ${playerName} (${socket.id}) left game ${gameId}.`);
        if (voteToRemove && game.quizVotes[voteToRemove] > 0) { game.quizVotes[voteToRemove]--; console.log(`Decremented vote for ${voteToRemove} due to disconnect.`); }
        delete game.players[socket.id]; delete game.playerAnswers[socket.id];
        io.to(gameId).emit("updateGameState", getSanitizedGameState(game));

        // Check if all remaining answered
        if (game.status === "question" && !wasAnswered) {
           const activePlayerIds = Object.keys(game.players);
           let allAnswered = false; // Default false
           if(activePlayerIds.length > 0) {
                let answeredCount = 0; activePlayerIds.forEach(pid => { if (game.players[pid]?.answered) answeredCount++; });
                allAnswered = (answeredCount === activePlayerIds.length);
                console.log(`G:${gameId} Q:${game.currentQuestionIndex} - Disconnect Check: RemPlayers: ${activePlayerIds.length}, Answered: ${answeredCount}, AllRemAnswered: ${allAnswered}`);
           } else {
               console.log(`G:${gameId} Q:${game.currentQuestionIndex} - Disconnect Check: No players remaining.`);
           }

           if (allAnswered) {
             console.log(`✅ G:${gameId} Q:${game.currentQuestionIndex} - All remaining answered after disconnect. Clearing timer (${game.questionTimer}) & showing results.`);
             clearTimeout(game.questionTimer); game.questionTimer = null;
             showResults(gameId);
           }
        } else if (game.status === 'waiting' && Object.keys(game.players).length === 0) { io.to(gameId).emit("updateGameState", getSanitizedGameState(game)); }
      }
    }
    socket.data.gameId = null;
  });

  // --- Game Reset (Host Action) ---
  socket.on("host:resetGame", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can reset the game."); return; }
    if (game.status !== "gameOver" && game.status !== "waiting") { socket.emit("error","Can only reset the game when it is over or waiting for players."); return; }
    console.log(`Host ${socket.id} resetting game ${gameId} to waiting state.`);
    game.status = "waiting"; game.currentQuestionIndex = -1; game.playerAnswers = {};
    game.selectedQuizId = null; game.selectedQuizName = null; game.quizVotes = {};
    clearTimeout(game.questionTimer); game.questionTimer = null;
    Object.values(game.players).forEach(player => { player.score = 0; player.answered = false; player.votedForQuizId = null; });
    io.to(gameId).emit("gameReset");
    io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
  });
});


// --- Game Logic Helper Functions ---
function nextQuestion(gameId) {
  const game = activeGames.get(gameId);
   if (!game || !game.selectedQuizId || !quizzes || !quizzes[game.selectedQuizId]) { console.error(`nextQuestion Error: Invalid game/quiz state G:${gameId}`); if(game) endGame(gameId); return; }
  const selectedQuizData = quizzes[game.selectedQuizId].data;
  game.currentQuestionIndex++;
  if (game.currentQuestionIndex >= selectedQuizData.length) { console.log(`G:${gameId} - No more questions. Ending game.`); endGame(gameId); return; }

  console.log(`G:${gameId} Q:${game.currentQuestionIndex + 1} - Preparing question.`);
  game.status = "question"; game.playerAnswers = {};
  Object.values(game.players).forEach(player => player.answered = false);
  const currentQuestion = selectedQuizData[game.currentQuestionIndex];
  const questionToSend = { gameId: gameId, index: game.currentQuestionIndex, text: currentQuestion.question, options: currentQuestion.options, duration: 15, fullQuizData: game.currentQuestionIndex === 0 ? selectedQuizData : undefined };

  console.log(`G:${gameId} Q:${game.currentQuestionIndex + 1} - Emitting showQuestion.`);
  io.to(gameId).emit("showQuestion", questionToSend);
  console.log(`G:${gameId} Q:${game.currentQuestionIndex + 1} - Emitting updateGameState (status: question).`);
  io.to(gameId).emit("updateGameState", getSanitizedGameState(game));

  const questionDuration = 15;
  const timerDurationMs = questionDuration * 1000 + 500;
  if (game.questionTimer) { console.log(`⏰ G:${gameId} Q:${game.currentQuestionIndex + 1} - Clearing existing timer ID: ${game.questionTimer} before setting new one.`); clearTimeout(game.questionTimer); }
  console.log(`⏰ G:${gameId} Q:${game.currentQuestionIndex + 1} - Setting NEW server timer for ${timerDurationMs} ms.`);
  game.questionTimer = setTimeout(() => {
      const currentGameTimer = activeGames.get(gameId);
      const timerIdWhenFired = game.questionTimer;
      console.log(`*** Server Timer FIRED for G:${gameId}, Q:${game.currentQuestionIndex + 1} (Timer ID: ${timerIdWhenFired}) ***`);
      if (currentGameTimer && currentGameTimer.status === "question" && currentGameTimer.currentQuestionIndex === game.currentQuestionIndex) {
          console.log(`   Timer Check Passed: Game exists, status is 'question', index matches.`);
          console.log(`   Calling showResults from timer.`);
          showResults(gameId);
      } else {
          console.log(`   Timer Check FAILED: Game State Changed or Game Ended.`);
          console.log(`   Current Game: ${!!currentGameTimer}, Status: ${currentGameTimer?.status}, Index: ${currentGameTimer?.currentQuestionIndex} (Expected Q Index: ${game.currentQuestionIndex})`);
          console.log(`   Timer for Q:${game.currentQuestionIndex + 1} ignored as it's outdated or game state changed.`);
      }
  }, timerDurationMs);
  console.log(`⏰ G:${gameId} Q:${game.currentQuestionIndex + 1} - New timer ID set: ${game.questionTimer}`);
}

function showResults(gameId) {
  const game = activeGames.get(gameId);
  if (!game) { console.error(`showResults Error: Game ${gameId} not found.`); return; }
  console.log(`>>> SERVER Check before calling showResults for G:${gameId}, Q:${game.currentQuestionIndex}, Status: ${game.status}`);

  if (game.status !== 'question') {
      console.warn(`showResults for G:${gameId} aborted. Status is already '${game.status}'.`);
      // Attempt to clear timer defensively if it still exists
      if (game.questionTimer) { console.log(`   Clearing potentially redundant timer (${game.questionTimer}) in showResults guard.`); clearTimeout(game.questionTimer); game.questionTimer = null; }
      return;
  }

  if (!game.selectedQuizId || !quizzes || !quizzes[game.selectedQuizId]) { console.error(`showResults Error: Invalid quiz state G:${gameId}`); return; }
  const selectedQuizData = quizzes[game.selectedQuizId].data;
  if (game.currentQuestionIndex < 0 || game.currentQuestionIndex >= selectedQuizData.length) { console.error(`showResults Error: Invalid Q index ${game.currentQuestionIndex} for G:${gameId}`); endGame(gameId); return; }

  console.log(`✅ G:${gameId} Q:${game.currentQuestionIndex + 1} - Proceeding to show results.`);
  game.status = "results";
  if (game.questionTimer) { console.log(`   Clearing timer (${game.questionTimer}) definitively within showResults.`); clearTimeout(game.questionTimer); game.questionTimer = null; }
  else { console.log(`   No active timer found to clear within showResults (likely cleared by 'allAnswered').`); }

  const currentQuestion = selectedQuizData[game.currentQuestionIndex];
  const correctAnswerIndex = currentQuestion.correctAnswer;
  const resultsData = { gameId: gameId, questionIndex: game.currentQuestionIndex, correctAnswer: correctAnswerIndex, scores: {}, };
  Object.entries(game.players).forEach(([id, player]) => {
    const submittedAnswer = game.playerAnswers[id]; const isCorrect = (submittedAnswer === correctAnswerIndex);
    if (isCorrect) { player.score += 100; }
    resultsData.scores[id] = { name: player.name, score: player.score, isCorrect: isCorrect, answered: player.answered, answer: submittedAnswer, };
  });

  console.log(`G:${gameId} Q:${game.currentQuestionIndex + 1} - Emitting showResults event.`);
  io.to(gameId).emit("showResults", resultsData);
  console.log(`G:${gameId} Q:${game.currentQuestionIndex + 1} - Emitting updateGameState (status: results).`);
  io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
}

function endGame(gameId) {
  const game = activeGames.get(gameId);
   if (!game) { console.warn(`endGame called for non-existent game ${gameId}.`); return; }
   if (game.status === 'gameOver') { console.warn(`Game ${gameId} is already over.`); return; }
  console.log(`G:${gameId} - Game Over.`);
  game.status = "gameOver"; clearTimeout(game.questionTimer); game.questionTimer = null; // Clear timer
  const finalScores = Object.values(game.players)
    .filter(player => player && typeof player.score === 'number')
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ name: p.name, score: p.score }));
  io.to(gameId).emit("gameOver", { gameId: gameId, scores: finalScores });
  io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
}

async function cleanupGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;
  console.log(`Cleaning up game ${gameId}...`); clearTimeout(game.questionTimer); game.questionTimer = null; // Clear timer
  try {
    const socketsInRoom = await io.in(gameId).fetchSockets();
    socketsInRoom.forEach((s) => { s.leave(gameId); if (s.data.gameId === gameId) { s.data.gameId = null; } });
     console.log(`Sockets removed from room ${gameId}`);
  } catch (error) { console.error(`Error fetching/leaving sockets for game ${gameId}:`, error); }
  activeGames.delete(gameId);
  console.log(`Game ${gameId} removed.`);
}

function getSanitizedGameState(game) {
  if (!game) return null;
  const sanitizedPlayers = {};
  for (const id in game.players) {
      if(game.players[id] && typeof game.players[id].name === 'string') {
          sanitizedPlayers[id] = {
              name: game.players[id].name, score: game.players[id].score,
              answered: game.players[id].answered, votedForQuizId: game.players[id].votedForQuizId
          };
      }
  }
  return {
    gameId: game.gameId, hostSocketId: game.hostSocketId, status: game.status,
    players: sanitizedPlayers, currentQuestionIndex: game.currentQuestionIndex,
    selectedQuizId: game.selectedQuizId, selectedQuizName: game.selectedQuizName,
    quizVotes: game.quizVotes, availableQuizzes: getAvailableQuizzesForClient()
  };
}

// --- Error/404 Handlers & Server Start ---
app.use((req, res, next) => {
    console.log(`--> 404 Not Found for path: ${req.path}`);
    res.status(404).send(`Sorry, can't find that resource: ${req.path}`);
});
app.use((err, req, res, next) => {
    console.error("!!! Unhandled Server Error:", err.stack || err);
    if (!res.headersSent) { res.status(500).send('Internal Server Error!'); }
});
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(", ")}`);
  const likelyUrl = allowedOrigins.find(url => url.includes('glitch.me')) || `http://localhost:${port}`;
  console.log(`App should be available at: ${likelyUrl}`);
  // Re-check quiz file access on startup
  const quizFilePath = path.resolve(__dirname, 'quizzes.json');
  fs.access(quizFilePath, fs.constants.R_OK, (err) => {
    if (err) { console.error(`[Server Startup Check] FAILED to access quizzes.json at: ${quizFilePath}`); }
    else { console.log(`[Server Startup Check] Successfully verified access to quizzes.json at: ${quizFilePath}`); }
  });
  // Check qrcode file access
  fs.access(qrcodePath, fs.constants.R_OK, (err) => {
    if (err) { console.error(`[Server Startup Check] FAILED to access qrcode.js at: ${qrcodePath}`); }
    else { console.log(`[Server Startup Check] Successfully verified access to qrcode.js at: ${qrcodePath}`); }
  });
});