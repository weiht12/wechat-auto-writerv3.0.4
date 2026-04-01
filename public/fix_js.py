import re

with open('app.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

content = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', content)
content = re.sub(r';\s*([a-zA-Z])', r';\n\1', content)
content = re.sub(r';\s*(const|let|var|function|async|class|if|else|for|while|try|catch|finally|return|export|import)', r';\n\1', content)
content = re.sub(r'{', '{\n', content)
content = re.sub(r'}', '\n}', content)
content = re.sub(r'\n{3,}', '\n\n', content)

with open('app.js.fixed', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')
