import { Router } from "express";
import { config } from "../config";

const router = Router();

router.post("/verify", (req, res) => {
  const pin = req.headers["x-auth-pin"] as string | undefined;
  const valid = Boolean(pin && pin === config.authPin);
  res.json({ valid });
});

router.put("/change-pin", (req, res) => {
  const { current_pin, new_pin } = req.body;

  if (!current_pin || current_pin !== config.authPin) {
    res.status(401).json({ error: "Invalid current PIN" });
    return;
  }
  if (!new_pin || new_pin.length < 4) {
    res.status(400).json({ error: "New PIN must be at least 4 characters" });
    return;
  }

  res.json({ success: true, message: "PIN change noted. Update AUTH_PIN env var to persist." });
});

export default router;
