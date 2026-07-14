// Validation harness for the ROS workspace tools + the full develop loop:
// create_ros_package -> build (ok) -> patch_file (break) -> build (real gcc
// error) -> patch_file (fix) -> build (ok). Uses colcon/ros2 for real.
import { rm, readFile, mkdir } from "node:fs/promises";
import { createRosPackage, buildRosWorkspace } from "./dist/ros-tools.js";
import { patchFile } from "./dist/file-tools.js";

const WS = "/tmp/ros2_devloop_ws";
const SRC = WS + "/src";
const CPP = SRC + "/dev_loop_demo/src/demo_node.cpp";
const hr = (t) => console.log("\n========== " + t + " ==========");
const show = (l, v) => console.log(l + " => " + JSON.stringify(v, null, 2));

await rm(WS, { recursive: true, force: true });
await mkdir(SRC, { recursive: true });

hr("1) create_ros_package(dev_loop_demo, ament_cmake, deps=[rclcpp], node=demo_node)");
show("result", await createRosPackage("dev_loop_demo", SRC, "ament_cmake", ["rclcpp"], "demo_node"));

hr("generated node source (src/dev_loop_demo/src/demo_node.cpp)");
console.log(await readFile(CPP, "utf8"));

hr("2) build_ros_workspace  [expect SUCCESS]");
show("result", await buildRosWorkspace(WS));

hr("3) patch_file: inject a compile error (append a garbage token to the main() signature)");
show("patch", await patchFile(CPP, "char ** argv)", "char ** argv) GARBAGE_TOKEN_ZZZ"));

hr("4) build_ros_workspace  [expect FAILURE with real compiler error in stderr]");
show("result", await buildRosWorkspace(WS));

hr("5) patch_file: fix it (remove the garbage token)");
show("patch", await patchFile(CPP, "char ** argv) GARBAGE_TOKEN_ZZZ", "char ** argv)"));

hr("6) build_ros_workspace  [expect SUCCESS again]");
show("result", await buildRosWorkspace(WS));

await rm(WS, { recursive: true, force: true });
console.log("\nDONE (workspace cleaned up).");
