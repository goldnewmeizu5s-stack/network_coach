import { Router } from "express";

const router = Router();

router.post("/verify", (req, res) => {
  const pin = req.headers["x-auth-pin"] as string | undefined;
  const authPin = process.env.AUTH_PIN;

  const valid = Boolean(authPin && pin === authPin);
  res.json({ valid });
});

export default router;
