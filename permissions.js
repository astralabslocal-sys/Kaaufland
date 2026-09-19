// Zentrale Rechte-Logik. Alle Berechtigungs-Entscheidungen laufen über diese
// Funktionen, sowohl für das, was im Admin-Bereich angezeigt wird, als auch
// für die serverseitige Prüfung in den Routen (die Anzeige allein reicht nie).
'use strict';

const STAFF_ROLES = ['teamler', 'supporter', 'admin', 'owner'];

function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

// Texte der Seite bearbeiten: nur Owner + Admin.
function canEditContent(role) {
  return role === 'owner' || role === 'admin';
}

// Gästebuch-Nachrichten bearbeiten/löschen: jeder eingeloggte Mitarbeiter.
function canModerateMessages(role) {
  return isStaff(role);
}

// Neue Mitarbeiter anlegen ("einstellen"): Admin und Owner.
function canCreateUsers(role) {
  return role === 'admin' || role === 'owner';
}

// Mitarbeiter kündigen / befördern / degradieren: nur Owner.
function canManageUsers(role) {
  return role === 'owner';
}

module.exports = {
  STAFF_ROLES,
  isStaff,
  canEditContent,
  canModerateMessages,
  canCreateUsers,
  canManageUsers,
};
