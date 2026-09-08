import 'dotenv/config'; //loads .env valuyes into process.env (must be first line)
import {createServer} from 'http'; //for real-time features later (socket.io)
import { Server } from 'socket.io';
import { connectDB } from './config/db.js'; //import the DB connection function
import { allowedClientOrigins, createApp } from './app.js';
import { configureSockets } from './socket.js';
import { registerNotificationSubscriber } from './events/notificationSubscriber.js';

// Keep HTTP and Socket.IO CORS in sync. CLIENT_ORIGIN accepts a comma-separated
// list so local dev can use either localhost or 127.0.0.1, and deploys can add
// the production web URL without code changes.
const CLIENT_ORIGINS = allowedClientOrigins();
const app = createApp();  //create the Express application
const httpServer = createServer(app); //create an HTTP server instance

// Attach Socket.IO to that same HTTP server.
// The `cors` block lets our (future) React client connect from its own origin.
const io = new Server(httpServer, {
    cors: {
        origin: CLIENT_ORIGINS,
        methods: ['GET', 'POST']
    }
});
app.set('io', io);

await connectDB();
// Register after database connection and before accepting requests so card
// assignment events have a subscriber ready to persist their notifications.
const stopNotificationSubscriber = registerNotificationSubscriber();
httpServer.once('close', stopNotificationSubscriber);
// Socket handlers live outside this bootstrap file so auth, presence, and board
// mutation events can evolve without turning server startup into a catch-all.
configureSockets(io);


const PORT = process.env.PORT || 5050; //read the port from.env, fallback to 5050

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
