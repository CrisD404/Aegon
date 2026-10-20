## Instalar

| Sistema | Archivo | Cómo |
|---|---|---|
| **Windows** | `Aegon_…_x64_en-US.msi` o `Aegon_…_x64-setup.exe` | Instalador. Windows puede avisar con SmartScreen ("Windows protegió tu PC"): **Más información → Ejecutar de todas formas** (el instalador no está firmado). |
| **Windows (portable)** | `Aegon_…_x64_portable.exe` o `.zip` | Sin instalar: se ejecuta directo. Usa WebView2, que ya viene con Windows 10 y 11. |
| **macOS** (Apple Silicon e Intel) | `Aegon_…_universal.dmg` | Arrastrá Aegon a Aplicaciones. La primera vez, **click derecho → Abrir** (la app no está firmada ni notarizada). Si dice que está dañada: `xattr -dr com.apple.quarantine /Applications/Aegon.app`. |
| **Linux** | `Aegon_…_amd64.AppImage` | Sin instalar: `chmod +x Aegon_*.AppImage` y ejecutarlo. |
| **Linux** (Debian, Ubuntu) | `Aegon_…_amd64.deb` | `sudo apt install ./Aegon_*.deb` |
| **Linux** (Fedora, RHEL) | `Aegon-….x86_64.rpm` | `sudo dnf install ./Aegon-*.rpm` |

También se puede usar en el navegador, sin instalar nada: la app web se publica en GitHub Pages
con cada versión.
