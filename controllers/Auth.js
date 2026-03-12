import jwt from "jsonwebtoken";
import Sessions from "../models/Session.js";
import bcrypt from "bcryptjs";
import ms from "ms";
import Session from "../models/Session.js";

export const refreshToken = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) {
    return res.status(401).json({ message: "No refresh token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const session = await Session.findOne({
      sessionId: payload.sessionId,
      revoked: false,
    }).select("+refreshTokenHash");

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        session.revoked = true;
        await session.save();
      }
      return res.status(401).json({ message: "Session expired" });
    }

    const isValid = await bcrypt.compare(token, session.refreshTokenHash);

    if (!isValid) {
      await Sessions.updateMany({ userId: payload.userId }, { revoked: true });

      return res.status(401).json({ message: "Refresh token reuse detected" });
    }

    const newAccessToken = jwt.sign(
      { userId: payload.userId, sessionId: payload.sessionId },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES }
    );

    const newRefreshToken = jwt.sign(
      { userId: payload.userId, sessionId: payload.sessionId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES }
    );

    session.refreshTokenHash = await bcrypt.hash(newRefreshToken, 12);
    session.updatedAt = new Date();
    await session.save();

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    res.status(200).json({ accessToken: newAccessToken });
  } catch (err) {
    console.error("Refresh token error:", err);
    res.status(401).json({ message: "Invalid refresh token" });
  }
};
