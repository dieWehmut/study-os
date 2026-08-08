package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"study-os/backend/models"
)

// activeVoiceRoleSettingKey stores which saved role reads text aloud. It lives
// in the generic settings table rather than as a column on voice_roles so that
// "exactly one is active" cannot be violated by a partial write.
const activeVoiceRoleSettingKey = "speech.active_voice_role"

const voiceRoleColumns = `id, name, bio, avatar_path, provider, base_url, model, voice, sort_order, created_at, updated_at`

func (s *Store) ListVoiceRoles(ctx context.Context) ([]models.VoiceRole, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+voiceRoleColumns+`
		FROM voice_roles
		ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := make([]models.VoiceRole, 0)
	for rows.Next() {
		role, err := scanVoiceRole(rows)
		if err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (s *Store) GetVoiceRole(ctx context.Context, id string) (models.VoiceRole, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+voiceRoleColumns+`
		FROM voice_roles WHERE id = ?`, strings.TrimSpace(id))
	role, err := scanVoiceRole(row)
	if err != nil {
		return models.VoiceRole{}, mapNotFound(err, "voice role")
	}
	return role, nil
}

func (s *Store) CreateVoiceRole(ctx context.Context, role models.VoiceRole) error {
	createdAt := role.CreatedAt
	if createdAt.IsZero() {
		createdAt = nowUTC()
	}
	updatedAt := role.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = createdAt
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO voice_roles(`+voiceRoleColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		role.ID, role.Name, role.Bio, role.AvatarPath, role.Provider,
		role.BaseURL, role.Model, role.Voice, role.SortOrder,
		formatTime(createdAt), formatTime(updatedAt))
	return err
}

// UpdateVoiceRole rewrites the editable fields of an existing role. The avatar
// is not one of them: it is uploaded through its own endpoint so a metadata save
// can never blank a picture the user did not touch.
func (s *Store) UpdateVoiceRole(ctx context.Context, role models.VoiceRole) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE voice_roles
		SET name = ?, bio = ?, provider = ?, base_url = ?, model = ?, voice = ?,
		    sort_order = ?, updated_at = ?
		WHERE id = ?`,
		role.Name, role.Bio, role.Provider, role.BaseURL, role.Model, role.Voice,
		role.SortOrder, formatTime(nowUTC()), strings.TrimSpace(role.ID))
	if err != nil {
		return err
	}
	return requireAffectedRow(result, "voice role")
}

func (s *Store) SetVoiceRoleAvatar(ctx context.Context, id, avatarPath string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE voice_roles SET avatar_path = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(avatarPath), formatTime(nowUTC()), strings.TrimSpace(id))
	if err != nil {
		return err
	}
	return requireAffectedRow(result, "voice role")
}

func (s *Store) DeleteVoiceRole(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	result, err := s.db.ExecContext(ctx, `DELETE FROM voice_roles WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if err := requireAffectedRow(result, "voice role"); err != nil {
		return err
	}
	// Clear the pointer rather than leaving it dangling: a stale active id would
	// make every later synthesis fall back silently instead of using a role the
	// user can see.
	active, err := s.GetSetting(ctx, activeVoiceRoleSettingKey)
	if err == nil && strings.TrimSpace(active) == id {
		_ = s.SetSetting(ctx, activeVoiceRoleSettingKey, "")
	}
	return nil
}

// ActiveVoiceRoleID returns the selected role id, or an empty string when the
// global 语音合成 defaults should be used.
func (s *Store) ActiveVoiceRoleID(ctx context.Context) (string, error) {
	value, err := s.GetSetting(ctx, activeVoiceRoleSettingKey)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(value), nil
}

// SetActiveVoiceRole selects the role used for playback. An empty id clears the
// selection and returns playback to the global defaults.
func (s *Store) SetActiveVoiceRole(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id != "" {
		if _, err := s.GetVoiceRole(ctx, id); err != nil {
			return err
		}
	}
	return s.SetSetting(ctx, activeVoiceRoleSettingKey, id)
}

func requireAffectedRow(result sql.Result, kind string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("%s: %w", kind, ErrNotFound)
	}
	return nil
}

func scanVoiceRole(row scanner) (models.VoiceRole, error) {
	var role models.VoiceRole
	var createdAt, updatedAt string
	if err := row.Scan(&role.ID, &role.Name, &role.Bio, &role.AvatarPath, &role.Provider,
		&role.BaseURL, &role.Model, &role.Voice, &role.SortOrder, &createdAt, &updatedAt); err != nil {
		return models.VoiceRole{}, err
	}
	role.HasAvatar = strings.TrimSpace(role.AvatarPath) != ""
	var err error
	if role.CreatedAt, err = parseTime(createdAt); err != nil {
		return models.VoiceRole{}, fmt.Errorf("parse voice role created time: %w", err)
	}
	if role.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return models.VoiceRole{}, fmt.Errorf("parse voice role updated time: %w", err)
	}
	return role, nil
}
