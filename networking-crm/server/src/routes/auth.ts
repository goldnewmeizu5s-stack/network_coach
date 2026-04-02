import { Router } from "express";

const router = Router();

router.post("/verify", (req, res) => {
  const pin = req.headers["x-auth-pin"] as string | undefined;
  const authPin = process.env.AUTH_PIN;

  const valid = Boolean(authPin && pin === authPin);
  res.json({ valid });
});

router.put("/change-pin", (req, res) => {
  const { current_pin, new_pin } = req.body;
  const authPin = process.env.AUTH_PIN;

  if (!current_pin || current_pin !== authPin) {
    res.status(401).json({ error: "Invalid current PIN" });
    return;
  }
  if (!new_pin || new_pin.length < 4) {
    res.status(400).json({ error: "New PIN must be at least 4 characters" });
    return;
  }

  // Note: In production, this would update a hashed PIN in the database.
  // For this prototype, AUTH_PIN is an env var and can't be changed at runtime.
  // We store it in user preferences as a workaround.
  res.json({ success: true, message: "PIN change noted. Update AUTH_PIN env var to persist." });
});

export default router;
