# SheetJS CE

`xlsx-0.20.3.tgz` is the unmodified official package from
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

It replaces the vulnerable, outdated npm-registry xlsx 0.18.5. package-lock.json
pins the archive integrity. The archive includes the upstream license. Node
installs this exact version from the official HTTPS URL with the same locked integrity.
The local archive is a reference copy, not an installation dependency: Timeweb installs
dependencies before copying application files; the existing browser bundle is also version 0.20.3.
Official installation/vendoring guidance:
https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
