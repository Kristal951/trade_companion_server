import express from "express";
import {
    deleteAllUserNotifications,
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/Notification.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";

const router = express.Router();

router.get("/", authenticateUser, getNotifications);
router.get("/unread-count", authenticateUser, getUnreadNotificationCount);
router.patch("/read-all", authenticateUser, markAllNotificationsRead);
router.patch("/:id/read", authenticateUser, markNotificationRead);
router.delete("/:id", authenticateUser, deleteNotification);
router.delete("/delete-all", authenticateUser, deleteAllUserNotifications);

export default router;
