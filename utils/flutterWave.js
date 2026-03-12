import Flutterwave from 'flutterwave-node-v3';
import dotenv from "dotenv";
dotenv.config();

export const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);
