import fs from "fs";
import path from "path";

export default function handler(req, res) {
    const filePath = path.join(process.cwd(), "data", "monitor_log.json");

    if (!fs.existsSync(filePath)) {
        return res.status(200).json({ time: null, latency: null, confidence: null, trigger: false });
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.status(200).json(data);
}
