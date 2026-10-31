// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Hello",
    targets: [
        .target(name: "Hello"),
        .testTarget(name: "HelloTests", dependencies: ["Hello"])
    ]
)
