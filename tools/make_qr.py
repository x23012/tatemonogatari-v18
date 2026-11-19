"""カード用QRコードを作る。使い方: pip install qrcode pillow → python make_qr.py https://公開URL
data/cards.json の全カード分、qr/<id>.png を作る。"""
import json, sys, os, qrcode
base = sys.argv[1].rstrip('/')
here = os.path.dirname(os.path.abspath(__file__))
cards = json.load(open(os.path.join(here, '..', 'data', 'cards.json'), encoding='utf-8'))['cards']
os.makedirs(os.path.join(here, '..', 'qr'), exist_ok=True)
for c in cards:
    qrcode.make(f"{base}/?card={c['id']}", box_size=10, border=2).save(os.path.join(here, '..', 'qr', f"{c['id']}.png"))
print(len(cards), 'QR codes')
