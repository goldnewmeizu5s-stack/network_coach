import { Router } from "express";

const router = Router();

router.get("/profile", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

router.put("/profile", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

export default router;
