import express, {Request, Response} from "express";
import cors from "cors";
import dotenv from "dotenv";
import {StreamChat} from 'stream-chat';
import { GoogleGenAI } from "@google/genai";
import { db } from './config/database.js';
import { chats, users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { ChatCompletionMessageParam } from "openai/resources";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:false}));

const chatClient = StreamChat.getInstance(
    process.env.STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!
);

app.post('/register-user', async function(req: Request, res: Response): Promise<any>{
    const {name, email} = req.body || {};
    if(!name || !email){
        return res.status(400).json({error: 'Name and email are required'});
    };
    try{
        const firstSplit = email.split('@');
        const userId = firstSplit[0] + firstSplit[1].split('.').join('');
        const userResponse = await chatClient.queryUsers({ id: { $eq: userId } });
        const buggyTypeScript = {
            id:userId,
            name:name,
            email:email,
            role:'user'
        };
        if(!userResponse.users.length){
            await chatClient.upsertUser(buggyTypeScript);
        };

        const existingUser = await db.select().from(users).where(eq(users.userId, userId));

        if(!existingUser.length){
            console.log('No user found. Adding new user');
            await db.insert(users).values({ userId, name, email });
        };

        res.status(200).json({userId, name, email});
    }catch(error){
        res.status(500).json({error:'Internal Server Error!'});
    };
    res.status(200).json({message: 'Win !'});
});

app.post('/chat', async function(req: Request, res: Response): Promise<any>{
    const { message, userId } = req.body || {};
    if(!message || !userId ){
        return res.status(400).json({error: 'Message and User required'});
    }
    try{
        const userResponse = await chatClient.queryUsers({id:userId});
        if(!userResponse.users.length){
            return res
            .status(404)
            .json({error:'No user found'});
        };
        const existingUser = await db.select().from(users).where(eq(users.userId, userId));
        if(!existingUser.length){
            console.log('No user found. Adding new user');
            return res.status(404).json({error:'No user found'})
        };
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: message,
        });
        let aiMessage: string = '';
        if(!response.text){
            aiMessage = 'No response from AI';
        }else{
            aiMessage = response.text;
        }
        await db.insert(chats).values({userId, message, reply:aiMessage});
        const buggyTypeScriptObject = {
            name: 'AI Chat',
            created_by_id: 'ai_bot',
        };
        const channel = chatClient.channel('messaging', 'chat-' + userId, buggyTypeScriptObject);
        await channel.create();
        await channel.sendMessage({ text: aiMessage, user_id: 'ai_bot' });
        res.status(200).json({reply:aiMessage});
    }catch(error){
        console.log(error);
    }
});

app.post('/get-messages', async function(req: Request, res: Response): Promise<any>{
    const userId = req.body.userId || {};
    if(!userId){
        return res.status(400).json({error:'User ID required'})
    };
    try{
        const chatHistory = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, userId));

        res.status(200).json({messages:chatHistory});

    }catch(error){
        console.log(error);
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, function(){
    console.log('win! we are running the server on port ' + PORT);
});
