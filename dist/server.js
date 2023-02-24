"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const pg_1 = require("pg");
require('dotenv').config();
const port = process.env.PORT || 8080;
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const client = new pg_1.Client({
    host: 'localhost',
    user: process.env.DATABASEUSER,
    port: 5432,
    password: process.env.DATABASEPASSWORD,
    database: process.env.DATABASENAME
});
function createTables() {
    return __awaiter(this, void 0, void 0, function* () {
        const createTableQuery = `
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM   information_schema.tables
            WHERE  table_name = 'users'
        ) THEN
            DELETE FROM users;
        END IF;
    
        IF EXISTS (
            SELECT 1
            FROM   information_schema.tables
            WHERE  table_name = 'global_messages'
        ) THEN
            DELETE FROM global_messages;
        END IF;
    
        IF EXISTS (
            SELECT 1
            FROM   information_schema.tables
            WHERE  table_name = 'private_messages'
        ) THEN
            DELETE FROM private_messages;
        END IF;
    END $$;
  
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  
    CREATE TABLE IF NOT EXISTS global_messages (
      author VARCHAR(255) NOT NULL,
      message VARCHAR(255) NOT NULL,
      time VARCHAR(255) NOT NULL
    );
  
    CREATE TABLE IF NOT EXISTS private_messages(
        author VARCHAR(255) NOT NULL,
        targetUser VARCHAR(255) NOT NULL,
        message VARCHAR(255) NOT NULL,
        time VARCHAR(255) NOT NULL
    );
  `;
        yield client.connect();
        yield client.query(createTableQuery);
        console.log('Connected to the database');
    });
}
createTables().catch((err) => {
    client.end().then(() => console.error(err));
});
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});
class User {
    constructor(notificationCount, username) {
        this.notificationCount = notificationCount;
        this.username = username;
    }
}
io.on('connection', (socket) => {
    let { username, targetUser } = socket.handshake.query;
    // insert a new user
    client.query('SELECT * FROM users WHERE username = $1', [username])
        .then((res) => __awaiter(void 0, void 0, void 0, function* () {
        if (!res.rows.length) {
            // private chat-room
            socket.join(username);
            console.log(`User ${username} connected with id ${socket.id}`);
            yield client.query('INSERT INTO users (username) VALUES ($1)', [username]);
            const result = yield client.query('SELECT * FROM users');
            const connectedUser = result.rows.map((row) => new User(0, row.username));
            io.emit('update_list', connectedUser);
        }
        else {
            socket.disconnect();
        }
    }));
    client.query('SELECT * FROM global_messages')
        .then((result) => {
        const messages = result.rows;
        io.emit('receive_message', messages);
    })
        .catch((error) => {
        console.error(error);
    });
    socket.on('get_new_targetuser', newTargetUser => targetUser = newTargetUser);
    socket.on('get_precedent_private_message', () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const result = yield client.query('SELECT * FROM private_messages');
            const messages = result.rows
                .filter(message => {
                return message.targetuser === targetUser && message.author === username
                    || message.author === targetUser && message.targetuser === username;
            });
            io.to(username).emit('receive_private_message', messages);
        }
        catch (error) {
            console.error(error);
        }
    }));
    socket.on('send_message', (messageData) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield client.query('INSERT INTO global_messages (author, message, time) VALUES ($1, $2, $3)', [messageData.author, messageData.message, messageData.time]);
            const result = yield client.query('SELECT * FROM global_messages');
            const messages = result.rows;
            io.emit('global_message_notification');
            io.emit('receive_message', messages);
        }
        catch (error) {
            console.error(error);
        }
    }));
    socket.on('send_private_message', (messageData) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield client.query('INSERT INTO private_messages (author, targetuser, message, time) VALUES ($1, $2, $3, $4)', [messageData.author, targetUser, messageData.message, messageData.time]);
            const result = yield client.query('SELECT * FROM private_messages');
            const messages = result.rows
                .filter(message => {
                return message.targetuser === targetUser && message.author === username
                    || message.author === targetUser && message.targetuser === username;
            });
            io.to(targetUser).emit('new_message_notification', messageData.author);
            io.to(messageData.author).emit('receive_private_message', messages);
            io.to(targetUser).emit('receive_private_message', messages);
        }
        catch (error) {
            console.error(error);
        }
    }));
    socket.on('disconnect', () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield client.query('DELETE FROM users WHERE username = $1', [username]);
            console.log(`User ${username} disconnected with id ${socket.id}`);
            const result = yield client.query('SELECT * FROM users');
            const connectedUser = result.rows.map((row) => new User(0, row.username));
            io.emit('update_list', connectedUser);
        }
        catch (error) {
            console.error(error);
        }
    }));
});
server.listen(port, () => console.log(`Server is running on port ${port}`));
