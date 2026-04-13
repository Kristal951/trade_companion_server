
import UserModel from "../models/User.js";
import { SymbolService } from "../services/symbol.js";

async function run() {
  try {
    const user = await UserModel.findOne({ "cTraderConfig.isConnected": true });

    if (!user) {
      console.error("No connected user found to fetch symbol data.");
      process.exit(1);
    }

    console.log(
      `Refreshing symbols using Account: ${user.cTraderConfig.accountId}`,
    );

    const service = new SymbolService(user.cTraderConfig.accountId);

    const updatedSymbols = await service.refreshCache();

    console.log(
      `✅ Success! Cached ${updatedSymbols.length} symbols with corrected contract sizes.`,
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to refresh cache:", error);
    process.exit(1);
  }
}

run();
