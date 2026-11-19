// テスト用の「机にカードを並べて、月のスタンプとコインをのせた写真」を作る（macOS）
// 数字の字体を見本とそろえるときは、環境変数 DIGITS に 1.png〜12.png（M PLUS Rounded 1c で描いた白い数字）のフォルダを入れる
// 使い方: swift make_table.swift <カード画像のフォルダ> <出力.jpg> <たね(数)> <スタンプの色 blue|black|pink|green> [hard]
// カード画像は <id>.jpg（印刷データから切り出したもの。大きいほどよい）
import AppKit

let a = CommandLine.arguments
let cardDir = a[1], outPath = a[2]
var seed = UInt64(a[3])!
let colorName = a[4], hard = a.count > 5 && a[5] == "hard"
func rnd() -> Double { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Double(seed >> 11) / Double(1 << 53) }
func R(_ lo: Double, _ hi: Double) -> Double { lo + rnd() * (hi - lo) }

let ids = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,40,41,42,44,45,46,47,48,49]
var pool = ids; for i in stride(from: pool.count - 1, to: 0, by: -1) { let j = Int(rnd() * Double(i + 1)); pool.swapAt(i, j) }
let chosen = Array(pool.prefix(12))
var months = Array(1...12); for i in stride(from: 11, to: 0, by: -1) { let j = Int(rnd() * Double(i + 1)); months.swapAt(i, j) }

let W = 4032.0, H = 3024.0
let stampColor: NSColor = ["blue": NSColor(srgbRed: 0.18, green: 0.56, blue: 0.86, alpha: 1),
                           "black": NSColor(srgbRed: 0.12, green: 0.12, blue: 0.13, alpha: 1),
                           "pink": NSColor(srgbRed: 0.91, green: 0.42, blue: 0.62, alpha: 1),
                           "green": NSColor(srgbRed: 0.20, green: 0.62, blue: 0.36, alpha: 1)][colorName]!

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W), pixelsHigh: Int(H), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let gctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = gctx
let ctx = gctx.cgContext
// 上を y=0 にする（画像と同じ向き）
ctx.translateBy(x: 0, y: H); ctx.scaleBy(x: 1, y: -1)

// 机（明るい木目）
NSColor(srgbRed: 0.89, green: 0.80, blue: 0.64, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
for _ in 0..<260 {
  let y = R(0, H), h = R(2, 14), a = R(0.02, 0.07)
  NSColor(srgbRed: 0.6, green: 0.45, blue: 0.28, alpha: a).setFill()
  let p = NSBezierPath(); p.move(to: NSPoint(x: 0, y: y))
  p.curve(to: NSPoint(x: W, y: y + R(-40, 40)), controlPoint1: NSPoint(x: W * 0.3, y: y + R(-30, 30)), controlPoint2: NSPoint(x: W * 0.7, y: y + R(-30, 30)))
  p.line(to: NSPoint(x: W, y: y + h)); p.line(to: NSPoint(x: 0, y: y + h)); p.close(); p.fill()
}

func shadow(_ blur: Double, _ alpha: Double) { ctx.setShadow(offset: CGSize(width: blur * 0.3, height: blur * 0.4), blur: blur, color: NSColor(white: 0, alpha: alpha).cgColor) }

let cols = 6, side = W / Double(cols) * 0.78
var truth: [String] = []
for (i, id) in chosen.enumerated() {
  let col = i % cols, row = i / cols
  let cx = (Double(col) + 0.5) * W / Double(cols) + R(-0.05, 0.05) * side
  let cy = H / 2 + (Double(row) - 0.5) * side * 1.22 + R(-0.05, 0.05) * side
  let ang = R(hard ? -14 : -6, hard ? 14 : 6) * .pi / 180
  guard let img = NSImage(contentsOfFile: "\(cardDir)/\(id).jpg") else { continue }
  ctx.saveGState(); ctx.translateBy(x: cx, y: cy); ctx.rotate(by: ang)
  // カード（白いふち・角丸）
  shadow(10, 0.28)
  let rect = NSRect(x: -side / 2, y: -side / 2, width: side, height: side)
  let clip = NSBezierPath(roundedRect: rect, xRadius: side * 0.03, yRadius: side * 0.03)
  NSColor.white.setFill(); clip.fill()
  ctx.setShadow(offset: .zero, blur: 0, color: nil)
  clip.addClip()
  ctx.saveGState(); ctx.translateBy(x: 0, y: side / 2); ctx.scaleBy(x: 1, y: -1)   // 画像は上下を戻して描く
  img.draw(in: NSRect(x: -side / 2, y: 0, width: side, height: side))
  ctx.restoreGState()
  ctx.restoreGState()

  // 月のスタンプ（白い角丸の紙に、色の丸と白い数字）。カードの写真の上あたりに
  let sx = cx + R(-0.1, 0.1) * side, sy = cy + R(-0.1, 0.1) * side, sa = R(-35, 35) * .pi / 180
  let paper = side * 0.40, r = side / 6.4   // 実際の写真での大きさ（スタンプの丸の半径 ≒ カードの 1/6.4）
  ctx.saveGState(); ctx.translateBy(x: sx, y: sy); ctx.rotate(by: sa)
  shadow(6, 0.25)
  NSColor(white: 0.97, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: -paper / 2, y: -paper / 2, width: paper, height: paper), xRadius: paper * 0.12, yRadius: paper * 0.12).fill()
  ctx.setShadow(offset: .zero, blur: 0, color: nil)
  stampColor.setFill(); NSBezierPath(ovalIn: NSRect(x: -r, y: -r, width: 2 * r, height: 2 * r)).fill()
  // 数字（プレイヤーの席＝写真の下から読める向き）
  ctx.rotate(by: -sa + R(-15, 15) * .pi / 180)
  // 実際のスタンプに近い丸ゴシック（ヒラギノ丸ゴ W4）。大きさは読み取りの見本と同じ（丸の半径の 0.91 倍、2けたは横 0.88 倍）
  if let dir = ProcessInfo.processInfo.environment["DIGITS"], let g = NSImage(contentsOfFile: "\(dir)/\(months[i]).png") {
    // 読み取りの見本と同じ字体（M PLUS Rounded 1c）で描いた数字の画像。画像の幅 = 丸の半径の 1.72 倍
    let gs = r * 1.72
    ctx.saveGState(); ctx.scaleBy(x: 1, y: -1)
    g.draw(in: NSRect(x: -gs / 2, y: -gs / 2, width: gs, height: gs))
    ctx.restoreGState()
  } else {
  let font = NSFont(name: "HiraMaruProN-W4", size: r * 0.91) ?? NSFont.systemFont(ofSize: r * 0.91)
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: "\(months[i])", attributes: [.font: font, .foregroundColor: NSColor.white]))
  let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
  ctx.saveGState(); ctx.scaleBy(x: months[i] >= 10 ? 0.88 : 1, y: -1)
  ctx.textMatrix = .identity; ctx.textPosition = CGPoint(x: -ink.midX, y: -ink.midY)
  CTLineDraw(line, ctx)
  ctx.restoreGState()
  }
  ctx.restoreGState()
  truth.append("\(months[i])\t\(id)\t\(Int(sx))\t\(Int(sy))")
}

// コイン（プラスチックの丸いコマ）。机の上と、カードに少しかかる所に
let coinColors = [NSColor(srgbRed: 0.98, green: 0.80, blue: 0.10, alpha: 1), NSColor(srgbRed: 0.10, green: 0.55, blue: 0.90, alpha: 1),
                  NSColor(srgbRed: 0.90, green: 0.20, blue: 0.20, alpha: 1), NSColor(srgbRed: 0.15, green: 0.65, blue: 0.35, alpha: 1)]
let coinR = side * 0.11
var coins: [(Double, Double)] = [(W * R(0.08, 0.3), H * R(0.08, 0.2)), (W * R(0.6, 0.9), H * R(0.08, 0.2)), (W * R(0.3, 0.7), H * R(0.82, 0.93))]
coins.append((W / Double(cols) * 2 + side * 0.42, H / 2 - side * 0.61 + side * 0.4))   // カードの角にかかる
if hard { coins.append((W / Double(cols) * 4.5 + side * 0.3, H / 2 + side * 0.61 - side * 0.35)) }
for (k, (x, y)) in coins.enumerated() {
  let c = coinColors[k % coinColors.count]
  shadow(8, 0.3)
  c.blended(withFraction: 0.25, of: .black)!.setFill(); NSBezierPath(ovalIn: NSRect(x: x - coinR, y: y - coinR + coinR * 0.12, width: 2 * coinR, height: 2 * coinR)).fill()
  ctx.setShadow(offset: .zero, blur: 0, color: nil)
  c.setFill(); NSBezierPath(ovalIn: NSRect(x: x - coinR, y: y - coinR, width: 2 * coinR, height: 2 * coinR)).fill()
  c.blended(withFraction: 0.15, of: .black)!.setStroke(); let ring = NSBezierPath(ovalIn: NSRect(x: x - coinR * 0.72, y: y - coinR * 0.72, width: coinR * 1.44, height: coinR * 1.44)); ring.lineWidth = coinR * 0.06; ring.stroke()
  NSColor(white: 1, alpha: 0.35).setFill(); NSBezierPath(ovalIn: NSRect(x: x - coinR * 0.55, y: y - coinR * 0.75, width: coinR * 0.6, height: coinR * 0.3)).fill()
}

// 照明（明るさのむら・色かぶり）
let grad = NSGradient(starting: NSColor(white: 1, alpha: hard ? 0.10 : 0.06), ending: NSColor(white: 0, alpha: hard ? 0.22 : 0.10))!
grad.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: R(20, 70))
if hard { NSColor(srgbRed: 0.2, green: 0.35, blue: 0.8, alpha: 0.06).setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill(using: .sourceOver) }
NSGraphicsContext.restoreGraphicsState()

// ノイズを少し
let p = rep.bitmapData!, n = Int(W) * Int(H)
for i in 0..<n { let d = Int(R(-6, 6)); for c in 0..<3 { let v = Int(p[i * 4 + c]) + d; p[i * 4 + c] = UInt8(max(0, min(255, v))) } }
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: outPath))
try! ("月\tカードID\tスタンプx\tスタンプy\n" + truth.sorted { Int($0.split(separator: "\t")[0])! < Int($1.split(separator: "\t")[0])! }.joined(separator: "\n") + "\n")
  .write(toFile: outPath.replacingOccurrences(of: ".jpg", with: "_正解.txt"), atomically: true, encoding: .utf8)
print("ok", outPath)
