import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { Client } from 'pg';
require('dotenv').config();

const port = 8080;
const app = express();

app.use(cors());

const client = new Client({
    host: process.env.HOST,
    user: process.env.DATABASEUSER,
    port: 5432,
    password: process.env.DATABASEPASSWORD,
    database: process.env.DATABASENAME
});

async function createTables() {
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
    await client.connect();
    await client.query(createTableQuery);
    console.log('Connected to the database');
}

createTables().catch((err) => {
    client.end().then(() => console.error(err));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'https://chat-app-backend-d6ly.onrender.com',
        methods: ['GET', 'POST'],
    },
});

interface MessageData {
    author: string;
    message: string;
    time: string;
}

class User {
    notificationCount : number;
    username: string;

    constructor(notificationCount: number, username: string) {
        this.notificationCount = notificationCount;
        this.username = username;
    }
}


io.on('connection', (socket: Socket) => {
    let { username, targetUser } = socket.handshake.query;

    // insert a new user
    client.query('SELECT * FROM users WHERE username = $1', [username])
        .then(async (res) => {
            if (!res.rows.length) {
                // private chat-room
                socket.join(<string>username);
                console.log(`User ${username} connected with id ${socket.id}`);

                await client.query('INSERT INTO users (username) VALUES ($1)', [username]);
                const result = await client.query('SELECT * FROM users');

                const connectedUser: User[] = result.rows.map((row) => new User(0,row.username));
                io.emit('update_list', connectedUser);
            }
            else {
                socket.disconnect();
            }
        });

    client.query('SELECT * FROM global_messages')
        .then((result) => {
            const messages: MessageData[] = result.rows;
            io.emit('receive_message', messages);
        })
        .catch((error) => {
            console.error(error);
    });

    socket.on('get_new_targetuser', newTargetUser => targetUser = newTargetUser);

    socket.on('get_precedent_private_message', async () => {
        try {
            const result = await client.query('SELECT * FROM private_messages');

            const messages: MessageData[] = result.rows
                .filter(message => {
                return message.targetuser === targetUser && message.author === username
                    || message.author === targetUser && message.targetuser === username;
            });

            io.to(<string>username).emit('receive_private_message', messages);
        } catch (error) {
            console.error(error);
        }
    });

    socket.on('send_message', async (messageData: MessageData) => {
         try {
             await client.query('INSERT INTO global_messages (author, message, time) VALUES ($1, $2, $3)',
                 [messageData.author, messageData.message, messageData.time]);

             const result = await client.query('SELECT * FROM global_messages');
             const messages: MessageData[] = result.rows;

             io.emit('global_message_notification');
             io.emit('receive_message', messages);
         } catch (error) {
             console.error(error);
         }
    });

    socket.on('send_private_message', async (messageData: MessageData) => {
         try {
             await client.query('INSERT INTO private_messages (author, targetuser, message, time) VALUES ($1, $2, $3, $4)',
                 [messageData.author, targetUser, messageData.message, messageData.time]);

             const result = await client.query('SELECT * FROM private_messages');
             const messages: MessageData[] = result.rows
                 .filter(message => {
                 return message.targetuser === targetUser && message.author === username
                     || message.author === targetUser && message.targetuser === username;
             });


             io.to(<string>targetUser).emit('new_message_notification', messageData.author);
             io.to(messageData.author).emit('receive_private_message', messages);
             io.to(<string>targetUser).emit('receive_private_message', messages);
         } catch (error) {
             console.error(error);
         }
    });

    socket.on('disconnect', async () => {
          try {
              await client.query('DELETE FROM users WHERE username = $1', [username]);
              console.log(`User ${username} disconnected with id ${socket.id}`);
              const result = await client.query('SELECT * FROM users');

              const connectedUser: User[] = result.rows.map((row) => new User(0,row.username));
              io.emit('update_list', connectedUser);
          } catch (error) {
              console.error(error);
          }
    });
});

server.listen(port, () => console.log(`Server is running on port ${port}`));
