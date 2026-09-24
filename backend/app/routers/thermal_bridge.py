"""Explicit round trip to Tower Thermal, scoped to an authorized evidence image."""
from datetime import datetime, timedelta
import hashlib
import hmac
import io
import secrets
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from PIL import Image as PILImage
from sqlalchemy import delete, update
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.deps import get_current_user, check_visit_team_access
from app.models import Image, ThermalEditGrant, User, UserRole
from app.routers.images import _load_image
from app.services.archive import save_upload, build_thumbnail

router=APIRouter(prefix="/api/thermal-bridge", tags=["thermal editor"])

def configured():
    if len(settings.thermal_bridge_secret)<32:
        raise HTTPException(503,"Thermal editor connection is not configured yet")

def service_key(x_thermal_service_key:str=Header(default="")):
    configured()
    if not hmac.compare_digest(x_thermal_service_key,settings.thermal_bridge_secret):
        raise HTTPException(403,"Invalid editor connection")

def eligible(img,user):
    if not user or not user.is_active or not user.is_approved or user.role not in {"admin","reviewer","inspector","team_leader","team_member"}:
        raise HTTPException(403,"Your account cannot process inspection images")
    check_visit_team_access(img.position.visit,user)
    if user.role=="team_member" and img.position.visit.assigned_member_id!=user.id:
        raise HTTPException(403,"This visit is not assigned to you")
    if img.image_type not in {"TH Full","TH Close"} or not img.file_path:
        raise HTTPException(400,"Upload a TH Full or TH Close image first")

def source_path(img):
    root=settings.images_dir.resolve();path=(root/img.file_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():raise HTTPException(404,"Original image is missing")
    return path

@router.post("/images/{image_id}/launch")
def launch(image_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    configured();img=_load_image(db,image_id,user);eligible(img,user);source_path(img)
    now=datetime.utcnow();token=secrets.token_urlsafe(32)
    db.execute(delete(ThermalEditGrant).where(ThermalEditGrant.edit_expires_at<now))
    db.add(ThermalEditGrant(token_hash=hashlib.sha256(token.encode()).hexdigest(),user_id=user.id,image_id=img.id,
                           expected_revision=img.updated_at,expires_at=now+timedelta(minutes=10),edit_expires_at=now+timedelta(hours=12)))
    db.commit()
    return {"url":"/thermal/#inspection="+token,"expires_in":600}

class Ticket(BaseModel):
    ticket:str=Field(min_length=32,max_length=100,pattern=r"^[A-Za-z0-9_-]+$")

def resolve(body,db,claimed=True):
    grant=db.get(ThermalEditGrant,hashlib.sha256(body.ticket.encode()).hexdigest())
    if not grant or grant.edit_expires_at<datetime.utcnow():raise HTTPException(410,"Editor link expired. Open Process thermal image again from the inspection.")
    if claimed and not grant.claimed_at:raise HTTPException(403,"Editor link has not been opened")
    user=db.get(User,grant.user_id)
    img=_load_image(db,grant.image_id,user) if user else None
    if not img:raise HTTPException(404,"Image no longer exists")
    eligible(img,user)
    if img.updated_at!=grant.expected_revision:raise HTTPException(409,"Inspection image changed while you were editing. Your thermal work is saved; reopen processing from the inspection to review the latest image.")
    return grant,img,user

@router.post("/claim",dependencies=[Depends(service_key)])
def claim(body:Ticket,db:Session=Depends(get_db)):
    grant,img,user=resolve(body,db,False);now=datetime.utcnow()
    changed=db.execute(update(ThermalEditGrant).where(ThermalEditGrant.token_hash==grant.token_hash,ThermalEditGrant.claimed_at.is_(None),ThermalEditGrant.expires_at>now).values(claimed_at=now)).rowcount
    if changed!=1:raise HTTPException(410,"Editor link already used or expired. Click Process thermal image again.")
    path=source_path(img);checksum=hashlib.sha256(path.read_bytes()).hexdigest()
    db.commit()
    return {"image_id":img.id,"user_id":user.id,"visit_id":img.position.visit_id,"image_type":img.image_type,
            "title":f"{img.position.visit.tower.tower_id} · {img.image_type} · {img.image_code or img.id}",
            "filename":Path(img.original_filename or path.name).name,"sha256":checksum,
            "return_path":f"/visits/{img.position.visit_id}","expires_at":grant.edit_expires_at.isoformat()+"Z"}

@router.post("/source",dependencies=[Depends(service_key)])
def source(body:Ticket,db:Session=Depends(get_db)):
    _,img,_=resolve(body,db)
    return FileResponse(source_path(img),media_type=img.content_type or "application/octet-stream",headers={"Cache-Control":"no-store"})

@router.post("/save",dependencies=[Depends(service_key)])
async def save(ticket:str=Form(...),file:UploadFile=File(...),db:Session=Depends(get_db)):
    grant,img,_=resolve(Ticket(ticket=ticket),db)
    raw=await file.read(settings.max_upload_size_mb*1024*1024+1)
    if len(raw)>settings.max_upload_size_mb*1024*1024:raise HTTPException(413,"Processed image is too large")
    try:
        with PILImage.open(io.BytesIO(raw)) as picture:
            if picture.format!="PNG":raise ValueError()
            picture.verify()
    except Exception:raise HTTPException(400,"The processed result must be a valid PNG image")
    digest=hashlib.sha256(raw).hexdigest()
    if grant.result_digest==digest:
        return {"saved":True,"image_id":img.id,"return_path":f"/visits/{img.position.visit_id}"}
    rel=f"thermal-edits/{img.id}/{uuid.uuid4().hex}.png"
    rel,_,_=save_upload(raw,rel);thumb=build_thumbnail(rel)
    now=datetime.utcnow()
    changed=db.execute(update(Image).where(Image.id==img.id,Image.updated_at==grant.expected_revision).values(
        annotated_path=rel,annotated_thumbnail_path=thumb,annotated_uploaded_at=now,updated_at=now)).rowcount
    if changed!=1:
        db.rollback();(settings.images_dir/rel).unlink(missing_ok=True)
        if thumb:(settings.thumbnails_dir/thumb).unlink(missing_ok=True)
        raise HTTPException(409,"This inspection image changed. Reopen it before saving back.")
    grant.expected_revision=now;grant.result_digest=digest
    db.commit()
    return {"saved":True,"image_id":img.id,"return_path":f"/visits/{img.position.visit_id}"}
