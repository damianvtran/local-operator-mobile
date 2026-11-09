#!/bin/bash
# Visual-order check with fribidi (UAX#9 reference impl) in an RTL paragraph. Reading right→left of the printed line = logical sense.
echo "fribidi: $(fribidi --version | head -1)"
while IFS= read -r l; do echo "LOGICAL: $l"; printf '%s' "$l" | fribidi --nobreak --rtl --nopad --charset UTF-8 --caprtl 2>&1 | head -0; printf '%s\n' "$l" | fribidi --rtl --nobreak --nopad 2>&1 | sed 's/^/  VISUAL: /'; done <<'L'
3 بیداریاں · اگلی بار 4m بعد
1 بیداری · 2h سے تاخیر
2 بیداریاں · اگلی بار 1h30m بعد
ہر 1d · 3 باقی
ہر 1h30m · کوئی ڈیلیوری باقی نہیں
5 میں سے 2 سنگ میل · 3 سیشنز
3 سیشنز · 2 فعال
وہ پاس ورڈ جو lop mobile سے ملا
آپ کے Radient اکاؤنٹ پر، منسلک نہیں
پروجیکٹ “alpha” مکمل کیا گیا۔
کیا پروجیکٹ “my-proj” حذف کریں؟ پروجیکٹ کا اندراج ہمیشہ کے لیے ہٹ جائے گا۔
L
