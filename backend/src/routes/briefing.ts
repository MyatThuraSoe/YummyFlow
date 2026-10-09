import express from "express";
import {
  generate,
  latest,
  list,
  getOne,
  metrics,
  remove,
} from "../controllers/briefing";
import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";

const briefingRouter = express.Router();

// AI briefings are management-only (PRO feature).
briefingRouter.use(requireAuth, checkRole(["ADMIN", "MANAGER"]));

briefingRouter.get("/latest", latest);
briefingRouter.get("/metrics", metrics);
briefingRouter.get("/", list);
briefingRouter.post("/generate", generate);
briefingRouter.get("/:id", getOne);
briefingRouter.delete("/:id", remove);

export default briefingRouter;
