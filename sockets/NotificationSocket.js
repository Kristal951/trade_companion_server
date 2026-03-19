import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const registerNotificationSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Authentication failed"));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const userIdFromToken = decoded?.userId || decoded?.id;

      if (!userIdFromToken) {
        return next(new Error("Authentication failed"));
      }

      const user = await User.findById(userIdFromToken).select("_id");

      if (!user) {
        return next(new Error("Authentication failed"));
      }

      socket.user = {
        userId: String(user._id),
      };

      next();
    } catch (error) {
      console.error("Socket auth error:", error.message);
      return next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user?.userId;

    if (userId) {
      const room = `user:${userId}`;
      socket.join(room);
      console.log(`✅ ${userId} connected to socket`);
      console.log(`📡 Joined room: ${room}`);

      socket.emit("notification:new", {
        _id: `test-${Date.now()}`,
        title: "Test Notification",
        message: "Realtime notification is working.",
        type: "test",
        createdAt: new Date(),
      });

      console.log("🔥 Test notification sent directly to connected socket");
    }

    socket.on("notification:mark-read", (notificationId) => {
      console.log(
        `🟢 User ${socket.user?.userId} marked notification as read: ${notificationId}`,
      );
    });

    socket.on("disconnect", (reason) => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
      console.log(`Reason: ${reason}`);

      if (socket.user?.userId) {
        console.log(`👤 ${socket.user.userId} has disconnected`);
      }
    });
  });
};
