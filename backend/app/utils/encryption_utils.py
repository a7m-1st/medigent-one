import base64
import os
from typing import Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_fernet() -> Optional[Fernet]:
    encryption_key = os.getenv("ENCRYPTION_KEY", "")
    if not encryption_key:
        return None

    try:
        key_bytes = (
            encryption_key.encode()
            if isinstance(encryption_key, str)
            else encryption_key
        )
        return Fernet(key_bytes)
    except Exception:
        return None


def _get_aes_key() -> Optional[bytes]:
    encryption_key = os.getenv("ENCRYPTION_KEY", "")
    if not encryption_key:
        return None

    try:
        key_bytes = (
            encryption_key.encode()
            if isinstance(encryption_key, str)
            else encryption_key
        )
        if len(key_bytes) == 44:
            return base64.urlsafe_b64decode(key_bytes)
        return None
    except Exception:
        return None


def decrypt(ciphertext: str) -> str:
    fernet = _get_fernet()
    if fernet is not None:
        try:
            return fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            pass

    aes_key = _get_aes_key()
    if aes_key is None:
        return ciphertext

    try:
        aesgcm = AESGCM(aes_key)
        data = base64.urlsafe_b64decode(ciphertext)
        nonce = data[:12]
        ciphertext_bytes = data[12:]
        plaintext = aesgcm.decrypt(nonce, ciphertext_bytes, None)
        return plaintext.decode()
    except Exception:
        return ciphertext


def is_encrypted(value: str) -> bool:
    if not value:
        return False

    fernet = _get_fernet()
    if fernet is not None:
        try:
            fernet.decrypt(value.encode())
            return True
        except Exception:
            pass

    aes_key = _get_aes_key()
    if aes_key is not None:
        try:
            aesgcm = AESGCM(aes_key)
            data = base64.urlsafe_b64decode(value)
            nonce = data[:12]
            ciphertext_bytes = data[12:]
            aesgcm.decrypt(nonce, ciphertext_bytes, None)
            return True
        except Exception:
            pass

    return False
