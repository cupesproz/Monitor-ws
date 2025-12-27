#!/usr/bin/env node

import fetch from "node-fetch";
import fs from "fs";
import { WebSocketServer } from "ws";
import express from "express"; // ✅ ditambahkan untuk Render

// ===== CONFIG =====
const TARGET_URL = "https://antrean.logammulia.com/antrean";
const INTERVAL = 1000; // ms
const LATENCY_THRESHOLD = 0.35;
const CONFIDENCE_THRESHOLD = 60;
const MAX_LATENCY_SPIKE = 0.5;
const SAMPLES_REQUIRED = 2;
const CSV_FILE = "monitor_log.csv";
const WS_PORT = 3000;

let running = true;
let latencyHistory = [];

// ===== UTILITY =====
function getTimeStr() {
    return new Date().toISOString().split("T")[1].split(".")[0];
}

function appendCSV(data) {
    const exists = fs.existsSync(CSV_FILE);
    const line = `${data.time},${data.latency},${data.confidence},${data.trigger}\n`;
    if (!exists) fs.writeFileSync(CSV_FILE, "time,latency,confidence,trigger\n");
    fs.appendFileSync(CSV_FILE, line);
}

// ===== WEBSOCKET SERVER PATCH UNTUK RENDER =====
const PORT = process.env.PORT || WS_PORT;
const app = express();

// HTTP endpoint opsional
app.get("/", (req, res) => res.send("WS server running"));

// Start HTTP server
const server = app.listen(PORT, () => console.log(`[START] Server listening on port ${PORT}`));

// Setup WS server via HTTP server (Render otomatis SSL/WSS)
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    console.log("[WS SERVER] Client connected");
    ws.send(JSON.stringify({ status: "connected" }));
});

// Fungsi broadcast tetap sama
function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// ===== MONITOR LATENCY =====
async function getLatency() {
    try {
        const start = Date.now();
        await fetch(TARGET_URL, { method: "HEAD" });
        const latency = (Date.now() - start) / 1000;
        latencyHistory.push(latency);
        if (latencyHistory.length > 50) latencyHistory.shift();
        return latency;
    } catch (err) {
        console.log(`[${getTimeStr()}] ERROR: ${err.message}`);
        return null;
    }
}

// ===== SMOOTH LATENCY =====
function getSmoothLatency() {
    const recent = latencyHistory.slice(-SAMPLES_REQUIRED);
    if (recent.length === 0) return null;
    return recent.reduce((a,b)=>a+b,0)/recent.length;
}

// ===== CONFIDENCE =====
function getConfidence() {
    const recent = latencyHistory.slice(-SAMPLES_REQUIRED);
    if (recent.length < SAMPLES_REQUIRED) return 0;
    const valid = recent.every(l => l <= LATENCY_THRESHOLD + MAX_LATENCY_SPIKE);
    return valid ? 50 + Math.random()*50 : Math.random()*20;
}

// ===== TRIGGER ENGINE =====
function checkTrigger(smoothLatency, confidence) {
    if (latencyHistory.length < 2) return false;
    const last2 = latencyHistory.slice(-2);
    const drop2x = last2[1] < last2[0];
    const second = new Date().getSeconds();
    return smoothLatency <= LATENCY_THRESHOLD &&
           confidence >= CONFIDENCE_THRESHOLD &&
           drop2x &&
           second % 2 === 1 &&
           last2[1] <= last2[0]+MAX_LATENCY_SPIKE;
}

// ===== SIGNAL EMOJI =====
function getSignal(trigger, smoothLatency, confidence) {
    if (trigger) return "馃煝 鉁� KLIK NOW!";
    else if (smoothLatency > LATENCY_THRESHOLD || confidence < CONFIDENCE_THRESHOLD) return "馃煛 鈿�";
    else return "馃敶 鉂�";
}

// ===== MAIN LOOP =====
console.log("[START] Stable HTTP latency monitoring with signal...");

process.on("SIGINT", ()=>{
    console.log("[EXIT] Cleaning up...");
    running = false;
    process.exit();
});

setInterval(async ()=>{
    if (!running) return;

    const latency = await getLatency();
    if (latency === null) return;

    const smoothLatency = getSmoothLatency();
    const confidence = getConfidence();
    const trigger = checkTrigger(smoothLatency, confidence);
    const signal = getSignal(trigger, smoothLatency, confidence);

    console.log(`[${getTimeStr()}] ${signal} | Latency: ${smoothLatency.toFixed(3)}s | Confidence: ${confidence.toFixed(1)}`);

    // LOG
    const log = { time:getTimeStr(), latency:smoothLatency.toFixed(3), confidence:confidence.toFixed(1), trigger };
    appendCSV(log);

    // BROADCAST KE TAMPMERMONKEY / CLIENT
    broadcast(log);

}, INTERVAL);
