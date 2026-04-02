import { Router } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/user/profile
router.get("/profile", async (_req, res, next) => {
  try {
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: {} });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/user/profile
router.put("/profile", async (req, res, next) => {
  try {
    const { name, goals, fears, strengths, weaknesses, preferences } = req.body;
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: {} });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(name !== undefined && { name }),
        ...(goals !== undefined && { goals }),
        ...(fears !== undefined && { fears }),
        ...(strengths !== undefined && { strengths }),
        ...(weaknesses !== undefined && { weaknesses }),
        ...(preferences !== undefined && { preferences }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
