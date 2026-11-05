import AppKit
let out = CommandLine.arguments[1]
let sizes = [16, 32, 128, 256, 512]
for size in sizes {
    for scale in [1, 2] {
        let px = size * scale
        let image = NSImage(size: NSSize(width: px, height: px))
        image.lockFocus()
        let f = CGFloat(px) / 1024
        let t = NSAffineTransform(); t.scale(by: f); t.concat()
        let body = NSBezierPath(roundedRect: NSRect(x: 54, y: 54, width: 916, height: 916), xRadius: 205, yRadius: 205)
        NSGradient(starting: NSColor(calibratedRed: 0.22, green: 0.34, blue: 0.29, alpha: 1), ending: NSColor(calibratedRed: 0.40, green: 0.55, blue: 0.44, alpha: 1))!.draw(in: body, angle: 65)
        let orbit = NSBezierPath(ovalIn: NSRect(x: 273, y: 273, width: 478, height: 478))
        NSColor(calibratedRed: 0.96, green: 0.95, blue: 0.88, alpha: 0.96).setStroke()
        orbit.lineWidth = 56; orbit.stroke()
        let tick = NSBezierPath(); tick.move(to: NSPoint(x: 411, y: 514)); tick.line(to: NSPoint(x: 490, y: 436)); tick.line(to: NSPoint(x: 652, y: 606))
        tick.lineWidth = 45; tick.lineCapStyle = .round; tick.lineJoinStyle = .round; tick.stroke()
        image.unlockFocus()
        let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
