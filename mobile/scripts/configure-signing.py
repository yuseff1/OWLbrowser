"""Point the release build at the keystore given via gradle.properties (OWL_UPLOAD_*)."""
import re, pathlib
p = pathlib.Path('app/build.gradle')
s = p.read_text()
block = """
        release {
            storeFile file(OWL_UPLOAD_STORE_FILE)
            storePassword OWL_UPLOAD_STORE_PASSWORD
            keyAlias OWL_UPLOAD_KEY_ALIAS
            keyPassword OWL_UPLOAD_KEY_PASSWORD
        }"""
s = re.sub(r'(signingConfigs\s*\{)', r'\1' + block, s, count=1)
head, sep, tail = s.partition('buildTypes')
tail = re.sub(r'(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug', r'\1signingConfig signingConfigs.release', tail, count=1, flags=re.S)
p.write_text(head + sep + tail)
print('Release signing configured with the provided keystore.')
