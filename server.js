const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const questions = [
    { q: "ما هي عاصمة مصر؟", correct: "القاهرة" },
    { q: "ما هو أكبر كوكب في المجموعة الشمسية؟", correct: "المشتري" },
    { q: "من هو مخترع المصباح الكهربائي؟", correct: "توماس إديسون" },
    { q: "ما هو الحيوان الذي يُعرف بسفينة الصحراء؟", correct: "الجمل" }
];

io.on('connection', (socket) => {
    let currentRoom = null;
    let playerName = null;

    socket.on('joinRoom', ({ roomCode, name }) => {
        currentRoom = roomCode;
        playerName = name;
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = { players: [], stage: 'waiting', currentQuestion: null, answers: [], votes: {} };
        }

        rooms[roomCode].players.push({ id: socket.id, name: name, score: 0 });
        io.to(roomCode).emit('playerList', rooms[roomCode].players.map(p => p.name));

        if (rooms[roomCode].players.length >= 2 && rooms[roomCode].stage === 'waiting') {
            startRound(roomCode);
        }
    });

    socket.on('submitAnswer', (answer) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        room.answers.push({ playerId: socket.id, playerName: playerName, text: answer });

        if (room.answers.length === room.players.length) {
            prepareVoting(currentRoom);
        }
    });

    socket.on('submitVote', (chosenAnswer) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (!room.votes[socket.id]) room.votes[socket.id] = chosenAnswer;

        if (Object.keys(room.votes).length === room.players.length) {
            calculateResults(currentRoom);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
            if (rooms[currentRoom].players.length === 0) delete rooms[currentRoom];
            else io.to(currentRoom).emit('playerList', rooms[currentRoom].players.map(p => p.name));
        }
    });
});

function startRound(roomCode) {
    const room = rooms[roomCode];
    room.stage = 'writing';
    room.answers = [];
    room.votes = {};
    const randomQ = questions[Math.floor(Math.random() * questions.length)];
    room.currentQuestion = randomQ;
    io.to(roomCode).emit('newQuestion', { question: randomQ.q });
}

function prepareVoting(roomCode) {
    const room = rooms[roomCode];
    room.stage = 'voting';
    let options = room.answers.map(a => ({ text: a.text, isPlayerAnswer: true, playerId: a.playerId }));
    options.push({ text: room.currentQuestion.correct, isPlayerAnswer: false, playerId: null });
    options = options.sort(() => Math.random() - 0.5);
    room.currentOptions = options;
    io.to(roomCode).emit('votingPhase', { options: options.map(o => o.text) });
}

function calculateResults(roomCode) {
    const room = rooms[roomCode];
    room.stage = 'results';
    let correctAnswer = room.currentQuestion.correct;

    room.players.forEach(player => {
        const playerVote = room.votes[player.id];
        const chosenOption = room.currentOptions.find(o => o.text === playerVote);
        if (chosenOption && !chosenOption.isPlayerAnswer) player.score += 1;
        else if (chosenOption && chosenOption.isPlayerAnswer) {
            const trickedPlayer = room.players.find(p => p.id === chosenOption.playerId);
            if (trickedPlayer) trickedPlayer.score += 1;
        }
    });

    io.to(roomCode).emit('showResults', {
        correctAnswer: correctAnswer,
        scores: room.players.map(p => ({ name: p.name, score: p.score }))
    });
    setTimeout(() => startRound(roomCode), 6000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
