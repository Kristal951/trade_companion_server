import path from "path";
import protobuf from "protobufjs";
import Long from "long"; // ✅ ADD THIS

let root;

export async function loadProtos() {
  if (root) return root;

  const protoDir = path.join(process.cwd(), "protos");

  // ✅ Proper Long configuration
  protobuf.util.Long = Long;
  protobuf.configure();

  root = await protobuf.load([
    path.join(protoDir, "OpenApiCommonMessages.proto"),
    path.join(protoDir, "OpenApiModelMessages.proto"),
    path.join(protoDir, "OpenApiMessages.proto"),
    path.join(protoDir, "OpenApiCommonModelMessages.proto"),
  ]);

  console.log("✅ Protos loaded (Common & Model)");

  return root;
}