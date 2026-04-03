import Notification from "../models/Notification.js";

export const buildNotificationPayload = ({
  recipient,
  actor = null,
  type,
  title,
  message,
  linkTo = null,
  image = null,
  priority = "normal",
  deliveryChannels = { inApp: true, email: false, push: false },
  meta = {},
  dedupeKey = null,
}) => ({
  recipient,
  actor,
  type,
  title,
  message,
  linkTo,
  image,
  priority,
  deliveryChannels,
  meta,
  dedupeKey,
});

export const findNotificationByDedupeKey = async (dedupeKey) => {
  if (!dedupeKey) return null;
  return Notification.findOne({ dedupeKey });
};

export const createNotification = async (payload) => {
  const builtPayload = buildNotificationPayload(payload);

  if (builtPayload.dedupeKey) {
    const existing = await findNotificationByDedupeKey(builtPayload.dedupeKey);
    if (existing) return existing;
  }

  try {
    const notification = await Notification.create(builtPayload);
    console.log(notification, "notif");
    return notification;
  } catch (error) {
    if (error?.code === 11000 && builtPayload.dedupeKey) {
      const existing = await findNotificationByDedupeKey(
        builtPayload.dedupeKey,
      );
      if (existing) return existing;
    }
    console.log(error);
    throw error;
  }
};

export const createManyNotifications = async (payloads = []) => {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];

  const docs = payloads.map((payload) => buildNotificationPayload(payload));

  const dedupeKeys = docs.map((doc) => doc.dedupeKey).filter(Boolean);

  let existingByKey = new Map();

  if (dedupeKeys.length > 0) {
    const existingNotifications = await Notification.find({
      dedupeKey: { $in: dedupeKeys },
    });

    existingByKey = new Map(
      existingNotifications.map((notification) => [
        notification.dedupeKey,
        notification,
      ]),
    );
  }

  const docsToCreate = docs.filter((doc) => {
    if (!doc.dedupeKey) return true;
    return !existingByKey.has(doc.dedupeKey);
  });

  let createdNotifications = [];

  if (docsToCreate.length > 0) {
    try {
      createdNotifications = await Notification.insertMany(docsToCreate, {
        ordered: false,
      });
    } catch (error) {
      if (error?.code !== 11000 && error?.name !== "BulkWriteError") {
        throw error;
      }

      const retryKeys = docsToCreate
        .map((doc) => doc.dedupeKey)
        .filter(Boolean);

      const fetched = retryKeys.length
        ? await Notification.find({
            dedupeKey: { $in: retryKeys },
          })
        : [];

      const fetchedMap = new Map(
        fetched.map((notification) => [notification.dedupeKey, notification]),
      );

      createdNotifications = docsToCreate
        .map((doc) => {
          if (doc.dedupeKey && fetchedMap.has(doc.dedupeKey)) {
            return fetchedMap.get(doc.dedupeKey);
          }
          return null;
        })
        .filter(Boolean);
    }
  }

  const allNotificationsMap = new Map();

  for (const notification of existingByKey.values()) {
    allNotificationsMap.set(String(notification._id), notification);
  }

  for (const notification of createdNotifications) {
    allNotificationsMap.set(String(notification._id), notification);
  }

  const notificationsWithoutDedupe = createdNotifications.filter(
    (notification) => !notification.dedupeKey,
  );

  for (const notification of notificationsWithoutDedupe) {
    allNotificationsMap.set(String(notification._id), notification);
  }

  return Array.from(allNotificationsMap.values());
};

export const emitNotificationToUser = ({ io, userId, notification }) => {
  if (!io || !userId || !notification) return;

  io.to(`user:${String(userId)}`).emit("notification:new", notification);
};

export const createAndSendNotification = async ({ io, ...payload }) => {
  const builtPayload = buildNotificationPayload(payload);

  let existing = null;

  if (builtPayload.dedupeKey) {
    existing = await findNotificationByDedupeKey(builtPayload.dedupeKey);
    if (existing) return existing;
  }

  const notification = await createNotification(builtPayload);

  if (!existing) {
    emitNotificationToUser({
      io,
      userId: builtPayload.recipient,
      notification,
    });
  }

  return notification;
};

export const createAndSendManyNotifications = async ({ io, payloads = [] }) => {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];

  const notifications = await createManyNotifications(payloads);

  if (io) {
    for (const notification of notifications) {
      io.to(`user:${String(notification.recipient)}`).emit(
        "notification:new",
        notification,
      );
    }
  }

  return notifications;
};
