import AppKit
// usage: img torgb in.png out.rgb  -> prints "w h" ; img tojpg in.rgb w h out.jpg
let a = CommandLine.arguments
if a[1] == "torgb" {
  let img = NSImage(contentsOfFile: a[2])!; let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
  let w = rep.pixelsWide, h = rep.pixelsHigh
  let cs = CGColorSpaceCreateDeviceRGB()
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.draw(rep.cgImage!, in: CGRect(x:0,y:0,width:w,height:h))
  let p = ctx.data!.bindMemory(to: UInt8.self, capacity: w*h*4)
  var out = Data(count: w*h*3); out.withUnsafeMutableBytes { (b: UnsafeMutableRawBufferPointer) in let o = b.bindMemory(to: UInt8.self)
    for i in 0..<(w*h) { o[i*3]=p[i*4]; o[i*3+1]=p[i*4+1]; o[i*3+2]=p[i*4+2] } }
  try! out.write(to: URL(fileURLWithPath: a[3])); print(w, h)
} else {
  let w = Int(a[3])!, h = Int(a[4])!; let d = try! Data(contentsOf: URL(fileURLWithPath: a[2]))
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: w*3, bitsPerPixel: 24)!
  d.copyBytes(to: rep.bitmapData!, count: w*h*3)
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])!.write(to: URL(fileURLWithPath: a[5]))
}
