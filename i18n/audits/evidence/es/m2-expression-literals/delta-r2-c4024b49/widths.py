ADV = [0.244,0.302,0.345,0.629,0.561,0.793,0.645,0.212,0.36,0.36,0.483,0.626,0.235,0.414,0.219,0.401,0.643,0.416,0.564,0.547,0.624,0.576,0.569,0.542,0.614,0.569,0.266,0.271,0.626,0.626,0.626,0.506,0.99,0.687,0.611,0.722,0.691,0.591,0.546,0.756,0.751,0.276,0.525,0.625,0.524,0.849,0.774,0.779,0.586,0.782,0.631,0.612,0.561,0.706,0.701,0.967,0.632,0.616,0.638,0.329,0.401,0.329,0.559,0.437,0.233,0.516,0.589,0.542,0.588,0.548,0.376,0.591,0.561,0.24,0.275,0.5,0.227,0.857,0.561,0.58,0.594,0.581,0.349,0.466,0.384,0.561,0.53,0.798,0.492,0.54,0.488,0.388,0.257,0.388,0.595]
def w(text, px):
    tot=0.0
    for ch in text:
        c=ord(ch)
        em = ADV[c-32] if 32<=c<=126 else 0.7
        tot += px*em
    return round(tot,1)

cases = {
 "es label Contexto": "Contexto",
 "es value 21% de contexto": "21% de contexto",
 "es value 100% de contexto": "100% de contexto",
 "es value 100% de contexto (aprox.)": "100% de contexto (aprox.)",
 "es old value 100% ctx": "100% ctx",
 "fr control 100 % du contexte": "100 % du contexte",
 "es no responde": "no responde",
}
for label,t in cases.items():
    print(f"{label:38s} 14px={w(t,14):6.1f}  28px={w(t,28):6.1f}  42px={w(t,42):6.1f}")

print()
for W in (320, 360, 390):
    content = W-32
    for scale in (1,2,3):
        label = w("Contexto", 14*scale)
        cell = content - label - 12
        print(f"W={W} scale={scale*100}%: label={label:6.1f} valueCell={cell:6.1f} "
              f"| needs(100%)={w('100% de contexto',14*scale):6.1f} "
              f"| fits={'YES' if w('100% de contexto',14*scale)<=cell else 'NO'}")
