export const emailVerificationtemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Verification Code</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      background: #f4f4f4;
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 520px;
      margin: 30px auto;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
    .header {
      text-align: center;
      padding: 24px 0;
      background: #ffffff;
      border-bottom: 1px solid #eee;
    }
    .header img {
      height: 80px;
      object-fit: contain;
    }
    .content {
      padding: 32px 24px;
      text-align: center;
    }
    .content h2 {
      color: #2e8b57;
      font-size: 20px;
      margin-bottom: 12px;
    }
    .content p {
      color: #333;
      margin: 6px 0;
    }
    .code-box {
      background: #f2f2f2;
      padding: 18px;
      font-size: 28px;
      font-weight: bold;
      letter-spacing: 6px;
      margin: 20px auto;
      color: #2e8b57;
      width: fit-content;
      border-radius: 8px;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #777;
      padding: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <h2>Hello {{NAME}},</h2>
      <p>Use the code below to complete your Trade Companion account signup.</p>
      <div class="code-box">{{CODE}}</div>
      <p>This code will expire in 60 minutes.</p>
      <p>If you didn't request this code, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p>Welcome onboard</p>
      &copy; {{YEAR}} {{APP_NAME}}. All rights reserved.
    </div>
  </div>
</body>
</html>`;


{/* <div class="header">
     <img src="https://res.cloudinary.com/dmhgzvadt/image/upload/v1751633520/Ahorify-removebg-preview_ap0hqd.png" alt="{{APP_NAME}} Logo" />
    </div> */}