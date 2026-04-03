import mongoose from "mongoose";
import Notification from "../models/Notification.js";

export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const skip = (page - 1) * limit;
    const type = req.query.type;

    const query = { recipient: userId };

    if (type) {
      query.type = type;
    }

    const [items, unreadCount, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({
        recipient: userId,
        isRead: false,
      }),
      Notification.countDocuments(query),
    ]);

    return res.status(200).json({
      items,
      unreadCount,
      page,
      total,
      hasMore: skip + items.length < total,
    });
  } catch (error) {
    console.error("getNotifications error:", error);
    return res.status(500).json({
      message: "Failed to fetch notifications",
    });
  }
};

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    return res.status(200).json({ unreadCount });
  } catch (error) {
    console.error("getUnreadNotificationCount error:", error);
    return res.status(500).json({
      message: "Failed to fetch unread count",
    });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      {
        isRead: true,
        readAt: new Date(),
      },
      { new: true },
    ).lean();

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    return res.status(200).json({
      message: "Notification marked as read",
      item: notification,
      unreadCount,
    });
  } catch (error) {
    console.error("markNotificationRead error:", error);
    return res.status(500).json({
      message: "Failed to mark notification as read",
    });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user?.userId;

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      message: "All notifications marked as read",
      unreadCount: 0,
    });
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    return res.status(500).json({
      message: "Failed to mark notifications as read",
    });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    return res.status(200).json({
      message: "Notification deleted",
      unreadCount,
    });
  } catch (error) {
    console.error("deleteNotification error:", error);
    return res.status(500).json({
      message: "Failed to delete notification",
    });
  }
};

export const deleteAllUserNotifications = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      message: "Not authenticated",
    });
  }

  try {
    const result = await Notification.deleteMany({
      recipient: userId,
    });

    return res.status(200).json({
      message: "All notifications deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("deleteAllUserNotifications error:", error);

    return res.status(500).json({
      message: "Failed to delete notifications",
    });
  }
};
