import PDFKit; import AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
for i in 0..<doc.pageCount { let p = doc.page(at: i)!; let b = p.bounds(for: .mediaBox); let s: CGFloat = 2.5
  let img = NSImage(size: NSSize(width: b.width*s, height: b.height*s)); img.lockFocus()
  NSColor.white.set(); NSRect(x:0,y:0,width:b.width*s,height:b.height*s).fill()
  let ctx = NSGraphicsContext.current!.cgContext; ctx.scaleBy(x: s, y: s); p.draw(with: .mediaBox, to: ctx); img.unlockFocus()
  let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!; try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "page\(i+1).png")) }
