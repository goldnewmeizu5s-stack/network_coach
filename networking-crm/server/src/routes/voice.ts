import { Router } from "express";

const router = Router();

router.post("/upload", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

export default router;
