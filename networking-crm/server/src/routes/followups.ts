import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

router.put("/:id", (_req, res) => {
  res.status(501).json({ message: "not implemented yet" });
});

export default router;
