from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import AppSetting
from app.routers.app_settings import get_public_branding


def test_login_branding_includes_both_names_without_private_configuration():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(AppSetting(id=1, org_name_en='Field inspection', org_name_ar='الفحص الميداني',
                          org_contact='Internal contact', org_report_footer='Internal footer'))
        db.commit()
        result = get_public_branding(db).model_dump()
        assert result == {
            'org_name_en': 'Field inspection', 'org_name_ar': 'الفحص الميداني',
            'org_logo_url': None, 'login_background_url': None,
        }
    engine.dispose()
