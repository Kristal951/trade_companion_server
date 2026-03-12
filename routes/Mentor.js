import express from "express";
import {
  createMentor,
  createMentorCheckout,
  createMentorPost,
  deleteMentorPost,
  editMentorPost,
  getAllMentorPostForAMentor,
  getAllMentors,
  getMentorByID,
  getMentorByUserID,
  submitReview,
  updateMentor,
} from "../controllers/Mentor.js";
import { upload } from "../utils/index.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";

const router = express.Router();

router.post("/createMentor", createMentor);
router.get("/getMentorByUserID/:userId", getMentorByUserID);
router.post("/createPost", upload.array("attachments", 5), createMentorPost);
router.get("/getAllMentorPost/:mentorId", getAllMentorPostForAMentor);
router.get("/getAllMentor", getAllMentors);
router.delete("/deteMentorPost/:postID", deleteMentorPost);
router.patch("/editMentorPost/:postID",  upload.array("files", 5), editMentorPost);
router.patch(
  "/updateMentor",
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "certifications", maxCount: 5 },
  ]),
  updateMentor
);
router.get("/getMentorByID/:mentorID", getMentorByID)
router.post("/review/:mentorId", submitReview);
router.post('/checkout', authenticateUser, createMentorCheckout)

export default router;
