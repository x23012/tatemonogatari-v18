"""カードPDF（表）から、アプリの見分け用カード画像 app/cards/<id>.jpg を作る（macOS用）。
使い方（このフォルダで）:
  swiftc -O img.swift -o img
  swift render.swift <カード表のPDF>     # page1.png〜 を作る（2.5倍）。今は ver18/たてものがたり_カード_表.pdf
  python3 cut_cards.py
カードの並びやPDFのレイアウトを変えたら、ORDER と XS/YS を直すこと。"""
import numpy as np, subprocess, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'app', 'cards')
S = 878                                   # カード1枚の大きさ（px, 2.5倍で描いたとき）
XS = [127, 1050, 1969]; YS = [255 + 921 * k for k in range(4)]
# PDFの並び順（ページ1左上から右へ）。'warp' はワープカード
ORDER = [29,33,23,22,30,31,34,36,11,2,27,7, 17,45,15,16,0,26,25,32,1,6,12,48,
         47,38,35,28,14,49,10,21,13,24,41,3, 44,37,4,5,8,9,18,19,40,42,46,'warp', None, None]   # ver18。最後は2枚目のワープと革命カード
os.makedirs(OUT, exist_ok=True)
pages = sorted(glob.glob(os.path.join(HERE, 'page*.png')), key=lambda p: int(p.split('page')[-1][:-4]))
n = 0
for pg in pages:
    w, h = map(int, subprocess.run([os.path.join(HERE, 'img'), 'torgb', pg, '/tmp/_p.rgb'], capture_output=True, text=True).stdout.split())
    a = np.fromfile('/tmp/_p.rgb', np.uint8).reshape(h, w, 3)
    for y in YS:
        for x in XS:
            if n >= len(ORDER): break
            cid = ORDER[n]; n += 1
            if cid is None or y + S > h: continue
            cr = a[y:y + S, x:x + S].astype(float)
            cr = cr[:S // 2 * 2, :S // 2 * 2].reshape(S // 2, 2, S // 2, 2, 3).mean((1, 3)).astype(np.uint8)
            cr.tofile('/tmp/_c.rgb')
            subprocess.run([os.path.join(HERE, 'img'), 'tojpg', '/tmp/_c.rgb', str(S // 2), str(S // 2), os.path.join(OUT, f'{cid}.jpg')])
print('done', n)
