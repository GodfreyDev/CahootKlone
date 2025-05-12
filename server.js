const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);

// --- Configuration ---
const allowedOrigins = [
  "http://localhost:3000",
  "https://cahootklone.glitch.me"
];

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) { callback(null, true); }
      else { console.warn(`[CORS Blocked] Origin: ${origin}`); callback(new Error(`Origin ${origin} not allowed by CORS`)); }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.use(express.json());

// --- MongoDB Connection ---
const MONGO_URI = "mongodb+srv://Godfrey:1uNswoV5GViFW3Or@kahoot-klone-cluster.1svtxji.mongodb.net/kahootCloneDb?retryWrites=true&w=majority";
let db;
let quizzesCollection;


const DBNAME_FROM_URI_MATCH = MONGO_URI.match(/\/\/.*?\/([^?]*)/);
const DBNAME_TO_USE = DBNAME_FROM_URI_MATCH && DBNAME_FROM_URI_MATCH[1] ? DBNAME_FROM_URI_MATCH[1] : "kahootClone_default_db"; // Fallback if not in URI or empty

async function connectDB() {
  console.log("[MongoDB] Attempting to connect...");
  try {
    // Create a MongoClient
    const client = new MongoClient(MONGO_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });

    console.log("[MongoDB] MongoClient created with Server API options. Calling connect()...");
    await client.connect();
    console.log("[MongoDB] Successfully connected to MongoDB server (after client.connect()).");

    // Explicitly get the database.
    db = client.db(DBNAME_TO_USE);

    console.log(`[MongoDB] Using database: ${db.databaseName}`);
    quizzesCollection = db.collection("quizzes");
    console.log("[MongoDB] Quizzes collection initialized ('quizzes').");

    // Send a ping to confirm successful connection
    await db.admin().command({ ping: 1 });
    console.log("[MongoDB] Ping successful.");

  } catch (error) {
    console.error("[MongoDB] Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

// --- Game Data ---
let quizzes = {}; // This will be populated from MongoDB

async function loadQuizzes() {
    console.log("[Server] Attempting to load quizzes from MongoDB...");
    if (!quizzesCollection) {
        console.error("[Quiz Load Error] Quizzes collection is not initialized. DB connection might have failed or not completed yet.");
        quizzes = {};
        return;
    }
    try {
        console.log("[Quiz Load] Fetching all documents from quizzes collection...");
        const quizzesFromDB = await quizzesCollection.find({}).toArray();
        console.log(`[Quiz Load] Found ${quizzesFromDB.length} documents in DB.`);

        const newQuizzes = {};
        quizzesFromDB.forEach(quizDoc => {
            if (quizDoc._id && quizDoc.name && Array.isArray(quizDoc.data)) {
                newQuizzes[quizDoc._id.toString()] = {
                    name: quizDoc.name,
                    data: quizDoc.data,
                    questionCount: quizDoc.data.length,
                };
            } else {
                console.error(`[Quiz Load Error] Invalid structure or missing _id for quiz document: ${JSON.stringify(quizDoc)}`);
            }
        });
        quizzes = newQuizzes;
        console.log(`[Server] Successfully loaded ${Object.keys(quizzes).length} quizzes into memory from MongoDB.`);
    } catch (error) {
        console.error("[Server] Error loading quizzes from MongoDB:", error);
        quizzes = {};
    }
}

function getAvailableQuizzesForClient() {
    if (!quizzes || Object.keys(quizzes).length === 0) {
        return [];
    }
    return Object.entries(quizzes).map(([id, details]) => {
        const questionCount = (details && details.data && Array.isArray(details.data)) ? details.data.length : 0;
        return {
            id: id,
            name: details.name || `Unnamed Quiz (${id})`,
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
    selectedQuizId: null,
    selectedQuizName: null,
    players: {},
    quizVotes: {},
    currentQuestionIndex: -1,
    questionTimer: null,
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

// --- Serve Files ---
const qrcodePath = path.resolve(__dirname, 'node_modules/qrcode-generator/qrcode.js');

app.get('/qrcode.js', (req, res, next) => {
  fs.access(qrcodePath, fs.constants.R_OK, (err) => {
      if (err) {
          console.error(`--> !!! Error accessing qrcode.js at resolved path ${qrcodePath}:`, err);
          res.status(500).send(`Internal Server Error: QR Code library (${qrcodePath}) not found or readable on server.`);
      } else {
          res.sendFile(qrcodePath, (sendErr) => {
              if (sendErr) {
                  console.error("--> !!! Error sending qrcode.js:", sendErr);
                  if (!res.headersSent) { next(sendErr); }
              }
          });
      }
  });
});

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

app.get("/quiz-editor", (req, res) => {
    console.log("--> Request received for /quiz-editor");
    res.sendFile(path.join(__dirname, "public", "quiz-editor.html"));
});

app.use(express.static(path.join(__dirname, "public")));


// --- API Endpoints for Quiz Management ---
app.get("/api/quizzes", async (req, res) => {
    console.log("[API GET /api/quizzes] Request received.");
    if (!quizzesCollection) {
        console.error("[API GET /api/quizzes] Quizzes collection not available.");
        return res.status(503).json({ message: "Database not available" });
    }
    try {
        const allQuizzes = await quizzesCollection.find({}).toArray();
        console.log(`[API GET /api/quizzes] Fetched ${allQuizzes.length} quizzes from DB.`);
        res.json(allQuizzes.map(q => ({...q, _id: q._id.toString()})));
    } catch (error) {
        console.error("[API GET /api/quizzes] Error fetching quizzes:", error);
        res.status(500).json({ message: "Error fetching quizzes" });
    }
});

app.get("/api/quizzes/:id", async (req, res) => {
    const quizId = req.params.id;
    console.log(`[API GET /api/quizzes/${quizId}] Request received for single quiz.`);
    if (!quizzesCollection) {
        console.error(`[API GET /api/quizzes/${quizId}] Quizzes collection not available.`);
        return res.status(503).json({ message: "Database not available" });
    }
    try {
        if (!ObjectId.isValid(quizId)) {
            console.warn(`[API GET /api/quizzes/${quizId}] Invalid quiz ID format.`);
            return res.status(400).json({ message: "Invalid quiz ID format." });
        }
        const quiz = await quizzesCollection.findOne({ _id: new ObjectId(quizId) });
        if (!quiz) {
            console.warn(`[API GET /api/quizzes/${quizId}] Quiz not found.`);
            return res.status(404).json({ message: "Quiz not found" });
        }
        console.log(`[API GET /api/quizzes/${quizId}] Fetched quiz: ${quiz.name}`);
        const quizToSend = {
            _id: quiz._id.toString(),
            name: quiz.name,
            data: quiz.data || [],
        };
        res.json(quizToSend);
    } catch (error) {
        console.error(`[API GET /api/quizzes/${quizId}] Error fetching quiz:`, error);
        res.status(500).json({ message: "Error fetching single quiz" });
    }
});

app.post("/api/quizzes", async (req, res) => {
    console.log("[API POST /api/quizzes] Request received.");
    if (!quizzesCollection) {
        console.error("[API POST /api/quizzes] Quizzes collection not available.");
        return res.status(503).json({ message: "Database not available" });
    }
    try {
        const newQuizData = req.body;
        if (!newQuizData.name || !Array.isArray(newQuizData.data) || newQuizData.data.length === 0) {
            console.warn("[API POST /api/quizzes] Invalid quiz data:", newQuizData);
            return res.status(400).json({ message: "Invalid quiz data. Name and at least one question are required." });
        }
        newQuizData.data.forEach((q, index) => {
            if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || typeof q.correctAnswer !== 'number') {
                console.warn(`[API POST /api/quizzes] Invalid question structure at index ${index}:`, q);
                throw new Error(`Invalid question structure in question ${index + 1}.`);
            }
        });

        const result = await quizzesCollection.insertOne({
            name: newQuizData.name,
            data: newQuizData.data,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        console.log(`[API POST /api/quizzes] Quiz created with ID: ${result.insertedId}`);
        await loadQuizzes();
        notifyWaitingRoomsOfQuizUpdate();
        res.status(201).json({ message: "Quiz created successfully", id: result.insertedId.toString() });
    } catch (error) {
        console.error("[API POST /api/quizzes] Error creating quiz:", error);
        res.status(500).json({ message: error.message || "Error creating quiz" });
    }
});

app.put("/api/quizzes/:id", async (req, res) => {
    const quizId = req.params.id;
    console.log(`[API PUT /api/quizzes/${quizId}] Request received.`);
    if (!quizzesCollection) {
        console.error(`[API PUT /api/quizzes/${quizId}] Quizzes collection not available.`);
        return res.status(503).json({ message: "Database not available" });
    }
    try {
        const updatedQuizData = req.body;
        if (!ObjectId.isValid(quizId)) {
            console.warn(`[API PUT /api/quizzes/${quizId}] Invalid quiz ID format.`);
            return res.status(400).json({ message: "Invalid quiz ID format." });
        }
        if (!updatedQuizData.name || !Array.isArray(updatedQuizData.data) || updatedQuizData.data.length === 0) {
            console.warn(`[API PUT /api/quizzes/${quizId}] Invalid quiz data:`, updatedQuizData);
            return res.status(400).json({ message: "Invalid quiz data. Name and at least one question are required." });
        }
        updatedQuizData.data.forEach((q, index) => {
            if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || typeof q.correctAnswer !== 'number') {
                 console.warn(`[API PUT /api/quizzes/${quizId}] Invalid question structure at index ${index}:`, q);
                throw new Error(`Invalid question structure in question ${index + 1}.`);
            }
        });

        const result = await quizzesCollection.updateOne(
            { _id: new ObjectId(quizId) },
            { $set: {
                name: updatedQuizData.name,
                data: updatedQuizData.data,
                updatedAt: new Date()
              }
            }
        );
        if (result.matchedCount === 0) {
            console.warn(`[API PUT /api/quizzes/${quizId}] Quiz not found for update.`);
            return res.status(404).json({ message: "Quiz not found" });
        }
        console.log(`[API PUT /api/quizzes/${quizId}] Quiz updated successfully. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
        await loadQuizzes();
        notifyWaitingRoomsOfQuizUpdate();
        res.json({ message: "Quiz updated successfully" });
    } catch (error) {
        console.error(`[API PUT /api/quizzes/${quizId}] Error updating quiz:`, error);
        res.status(500).json({ message: error.message || "Error updating quiz" });
    }
});

app.delete("/api/quizzes/:id", async (req, res) => {
    const quizId = req.params.id;
    console.log(`[API DELETE /api/quizzes/${quizId}] Request received.`);
    if (!quizzesCollection) {
        console.error(`[API DELETE /api/quizzes/${quizId}] Quizzes collection not available.`);
        return res.status(503).json({ message: "Database not available" });
    }
    try {
        if (!ObjectId.isValid(quizId)) {
            console.warn(`[API DELETE /api/quizzes/${quizId}] Invalid quiz ID format.`);
            return res.status(400).json({ message: "Invalid quiz ID format." });
        }
        const result = await quizzesCollection.deleteOne({ _id: new ObjectId(quizId) });
        if (result.deletedCount === 0) {
            console.warn(`[API DELETE /api/quizzes/${quizId}] Quiz not found for deletion.`);
            return res.status(404).json({ message: "Quiz not found" });
        }
        console.log(`[API DELETE /api/quizzes/${quizId}] Quiz deleted successfully. Count: ${result.deletedCount}`);
        await loadQuizzes();
        notifyWaitingRoomsOfQuizUpdate();
        res.json({ message: "Quiz deleted successfully" });
    } catch (error) {
        console.error(`[API DELETE /api/quizzes/${quizId}] Error deleting quiz:`, error);
        res.status(500).json({ message: "Error deleting quiz" });
    }
});

function notifyWaitingRoomsOfQuizUpdate() {
    console.log("[Notification] Checking for waiting rooms to notify of quiz list update...");
    let notifiedCount = 0;
    activeGames.forEach(game => {
        if (game.status === 'waiting') {
            console.log(`[Notification] Notifying game ${game.gameId}`);
            io.to(game.gameId).emit('updateGameState', getSanitizedGameState(game));
            notifiedCount++;
        }
    });
    if (notifiedCount > 0) {
        console.log(`[Notification] Notified ${notifiedCount} waiting game(s).`);
    } else {
        console.log("[Notification] No active waiting games to notify.");
    }
}

// --- Socket.IO Connection Logic ---
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.data.gameId = null;

  socket.on("host:createGame", () => {
    if (socket.data.gameId && activeGames.has(socket.data.gameId)) { socket.emit("error", "You are already in a game."); return; }
    const gameId = generateGameId(); const newGame = createNewGameState(socket.id);
    newGame.gameId = gameId; activeGames.set(gameId, newGame);
    socket.data.gameId = gameId; socket.join(gameId);
    console.log(`Host ${socket.id} created Game Room: ${gameId}. Sending ${getAvailableQuizzesForClient().length} available quizzes.`);
    socket.emit("gameCreated", { gameId: gameId, hostId: socket.id, availableQuizzes: getAvailableQuizzesForClient() });
    io.to(gameId).emit("updateGameState", getSanitizedGameState(newGame));
  });

   socket.on("host:selectQuiz", (quizId) => {
       const gameId = socket.data.gameId; const game = activeGames.get(gameId);
       if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can select a quiz."); return; }
       if (game.status !== "waiting") { socket.emit("error", "Cannot change quiz after the game has started."); return; }
       if (!quizzes || !quizzes[quizId]) {
           console.error(`[Socket host:selectQuiz] Host ${socket.id} tried to select non-existent quiz ID: ${quizId}. Available: ${Object.keys(quizzes).join(', ')}`);
           socket.emit("error", `Selected quiz (ID: ${quizId}) not found/loaded.`); return;
       }
       game.selectedQuizId = quizId; game.selectedQuizName = quizzes[quizId].name;
       console.log(`Game ${gameId}: Host FINALIZED selection to '${game.selectedQuizName}' (ID: ${quizId})`);
       io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
   });

  socket.on("host:startGame", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can start the game."); return; }
    if (game.status !== "waiting") { socket.emit("error", "Game is not in a waiting state."); return; }
     if (!game.selectedQuizId) { socket.emit("error", "Please select a quiz before starting."); return; }
     if (!quizzes || !quizzes[game.selectedQuizId]) { socket.emit("error", "Selected quiz data is not available."); return; }
     const playerIds = Object.keys(game.players);
     if (playerIds.length === 0) { socket.emit("error", "Need at least one player to start."); return; }
    console.log(`Game ${gameId} starting with quiz '${game.selectedQuizName}'...`);
    game.status = "question"; game.currentQuestionIndex = -1; clearTimeout(game.questionTimer); game.questionTimer = null;
    nextQuestion(gameId);
  });

  socket.on("host:nextQuestion", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can advance the question."); return; }
    if (game.status === "results") {
        console.log(`G:${gameId} - Host manually triggered nextQuestion.`);
        clearTimeout(game.questionTimer); game.questionTimer = null;
        nextQuestion(gameId);
    } else { socket.emit("error", "Can only advance to next question from results screen."); }
  });

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
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || !game.players[socket.id] || socket.id === game.hostSocketId) { return; }
    if (game.status !== "question") { return; }
    if (!quizzes || !game.selectedQuizId || !quizzes[game.selectedQuizId]) { return; }
    const selectedQuizData = quizzes[game.selectedQuizId].data;
    if (game.currentQuestionIndex < 0 || game.currentQuestionIndex >= selectedQuizData.length) { return; }
    const currentQuestion = selectedQuizData[game.currentQuestionIndex];
    if (typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex >= currentQuestion.options.length) { socket.emit("error", "Invalid answer submitted."); return; }
    if (game.players[socket.id].answered) { return; }

    game.players[socket.id].answered = true;
    game.playerAnswers[socket.id] = answerIndex;
    const activePlayerIds = Object.keys(game.players);
    let allAnswered = false;
    if (activePlayerIds.length > 0) {
        let answeredCount = 0; activePlayerIds.forEach(pid => { if (game.players[pid]?.answered) answeredCount++; });
        allAnswered = (answeredCount === activePlayerIds.length);
    }
    if (allAnswered) {
      clearTimeout(game.questionTimer); game.questionTimer = null;
      showResults(gameId);
    } else {
      io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
    }
  });

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
        if (voteToRemove && game.quizVotes[voteToRemove] > 0) { game.quizVotes[voteToRemove]--; }
        delete game.players[socket.id]; delete game.playerAnswers[socket.id];
        io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
        if (game.status === "question" && !wasAnswered) {
           const activePlayerIds = Object.keys(game.players);
           let allAnswered = activePlayerIds.length > 0 && activePlayerIds.every(pid => game.players[pid]?.answered);
           if (allAnswered) {
             clearTimeout(game.questionTimer); game.questionTimer = null;
             showResults(gameId);
           }
        } else if (game.status === 'waiting' && Object.keys(game.players).length === 0) { io.to(gameId).emit("updateGameState", getSanitizedGameState(game)); }
      }
    }
    socket.data.gameId = null;
  });

  socket.on("host:resetGame", () => {
    const gameId = socket.data.gameId; const game = activeGames.get(gameId);
    if (!game || game.hostSocketId !== socket.id) { socket.emit("error", "Only the host can reset the game."); return; }
    if (game.status !== "gameOver" && game.status !== "waiting") { socket.emit("error","Can only reset the game when it is over or waiting for players."); return; }
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

  game.status = "question"; game.playerAnswers = {};
  Object.values(game.players).forEach(player => player.answered = false);
  const currentQuestion = selectedQuizData[game.currentQuestionIndex];
  const questionToSend = { gameId: gameId, index: game.currentQuestionIndex, text: currentQuestion.question, options: currentQuestion.options, duration: 15, fullQuizData: game.currentQuestionIndex === 0 ? selectedQuizData : undefined };

  io.to(gameId).emit("showQuestion", questionToSend);
  io.to(gameId).emit("updateGameState", getSanitizedGameState(game));

  const questionDuration = 15; const timerDurationMs = questionDuration * 1000 + 500;
  if (game.questionTimer) { clearTimeout(game.questionTimer); }
  game.questionTimer = setTimeout(() => {
      const currentGameTimer = activeGames.get(gameId);
      if (currentGameTimer && currentGameTimer.status === "question" && currentGameTimer.currentQuestionIndex === game.currentQuestionIndex) {
          showResults(gameId);
      }
  }, timerDurationMs);
}

function showResults(gameId) {
  const game = activeGames.get(gameId);
  if (!game) { return; }
  if (game.status !== 'question') {
      if (game.questionTimer) { clearTimeout(game.questionTimer); game.questionTimer = null; }
      return;
  }
  if (!game.selectedQuizId || !quizzes || !quizzes[game.selectedQuizId]) { return; }
  const selectedQuizData = quizzes[game.selectedQuizId].data;
  if (game.currentQuestionIndex < 0 || game.currentQuestionIndex >= selectedQuizData.length) { endGame(gameId); return; }

  game.status = "results";
  if (game.questionTimer) { clearTimeout(game.questionTimer); game.questionTimer = null; }

  const currentQuestion = selectedQuizData[game.currentQuestionIndex];
  const correctAnswerIndex = currentQuestion.correctAnswer;
  const resultsData = { gameId: gameId, questionIndex: game.currentQuestionIndex, correctAnswer: correctAnswerIndex, scores: {}, };
  Object.entries(game.players).forEach(([id, player]) => {
    const submittedAnswer = game.playerAnswers[id]; const isCorrect = (submittedAnswer === correctAnswerIndex);
    if (isCorrect) { player.score += 100; }
    resultsData.scores[id] = { name: player.name, score: player.score, isCorrect: isCorrect, answered: player.answered, answer: submittedAnswer, };
  });
  io.to(gameId).emit("showResults", resultsData);
  io.to(gameId).emit("updateGameState", getSanitizedGameState(game));
}

function endGame(gameId) {
  const game = activeGames.get(gameId);
   if (!game) { return; }
   if (game.status === 'gameOver') { return; }
  game.status = "gameOver"; clearTimeout(game.questionTimer); game.questionTimer = null;
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
  clearTimeout(game.questionTimer); game.questionTimer = null;
  try {
    const socketsInRoom = await io.in(gameId).fetchSockets();
    socketsInRoom.forEach((s) => { s.leave(gameId); if (s.data.gameId === gameId) { s.data.gameId = null; } });
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

async function startServer() {
    console.log("[Server Startup] Starting server initialization...");
    await connectDB();
    console.log("[Server Startup] Database connection established. Loading initial quizzes...");
    await loadQuizzes();
    console.log("[Server Startup] Initial quizzes loaded. Starting HTTP server...");

    server.listen(port, () => {
        console.log(`[Server Startup] Server listening on port ${port}`);
        console.log(`[Server Startup] Allowed CORS origins: ${allowedOrigins.join(", ")}`);
        const likelyUrl = allowedOrigins.find(url => url.includes('glitch.me')) || `http://localhost:${port}`;
        console.log(`[Server Startup] App should be available at: ${likelyUrl}`);
        console.log(`[Server Startup] Serving static files from: ${path.join(__dirname, "public")}`);

        fs.access(qrcodePath, fs.constants.R_OK, (err) => {
           if (err) { console.error(`[Server Startup Check] FAILED to access qrcode.js at: ${qrcodePath}`); } 
        });
    });
}

startServer();