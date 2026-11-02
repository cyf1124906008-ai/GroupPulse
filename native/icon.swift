import Cocoa
import ImageIO
import UniformTypeIdentifiers

let target = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
for (name, size) in [("icon_16x16",16), ("icon_16x16@2x",32), ("icon_32x32",32), ("icon_32x32@2x",64), ("icon_128x128",128), ("icon_128x128@2x",256), ("icon_256x256",256), ("icon_256x256@2x",512), ("icon_512x512",512), ("icon_512x512@2x",1024)] {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: CGFloat(size)/1024, y: CGFloat(size)/1024)
    ctx.setFillColor(CGColor(red: 0.075, green: 0.43, blue: 0.35, alpha: 1))
    ctx.addPath(CGPath(roundedRect: CGRect(x: 54, y: 54, width: 916, height: 916), cornerWidth: 202, cornerHeight: 202, transform: nil)); ctx.fillPath()
    ctx.setLineWidth(40); ctx.setLineJoin(.round); ctx.setLineCap(.round)
    ctx.setStrokeColor(CGColor(red: 0.57, green: 0.86, blue: 0.77, alpha: 1))
    ctx.addPath(CGPath(roundedRect: CGRect(x: 302, y: 208, width: 506, height: 410), cornerWidth: 77, cornerHeight: 77, transform: nil)); ctx.strokePath()
    ctx.setFillColor(CGColor(red: 0.98, green: 1, blue: 0.99, alpha: 1))
    let bubble = CGMutablePath(); bubble.move(to: CGPoint(x: 268, y: 776)); bubble.addLine(to: CGPoint(x: 660, y: 776)); bubble.addQuadCurve(to: CGPoint(x: 730, y: 706), control: CGPoint(x: 730, y: 776)); bubble.addLine(to: CGPoint(x: 730, y: 466)); bubble.addQuadCurve(to: CGPoint(x: 660, y: 396), control: CGPoint(x: 730, y: 396)); bubble.addLine(to: CGPoint(x: 416, y: 396)); bubble.addLine(to: CGPoint(x: 274, y: 298)); bubble.addLine(to: CGPoint(x: 288, y: 396)); bubble.addLine(to: CGPoint(x: 268, y: 396)); bubble.addQuadCurve(to: CGPoint(x: 198, y: 466), control: CGPoint(x: 198, y: 396)); bubble.addLine(to: CGPoint(x: 198, y: 706)); bubble.addQuadCurve(to: CGPoint(x: 268, y: 776), control: CGPoint(x: 198, y: 776)); bubble.closeSubpath(); ctx.addPath(bubble); ctx.fillPath()
    ctx.setStrokeColor(CGColor(red: 0.075, green: 0.43, blue: 0.35, alpha: 1)); ctx.setLineWidth(34)
    ctx.move(to: CGPoint(x: 283, y: 570)); ctx.addLine(to: CGPoint(x: 372, y: 570)); ctx.addLine(to: CGPoint(x: 426, y: 654)); ctx.addLine(to: CGPoint(x: 493, y: 505)); ctx.addLine(to: CGPoint(x: 550, y: 596)); ctx.addLine(to: CGPoint(x: 642, y: 596)); ctx.strokePath()
    let image = ctx.makeImage()!, url = target.appendingPathComponent(name + ".png")
    let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(output, image, nil); guard CGImageDestinationFinalize(output) else { fatalError("PNG failed") }
}
