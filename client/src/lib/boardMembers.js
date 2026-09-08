// Membership payloads may contain a populated user or only its stored ID.
export function memberUserId(member) {
  return member.user?.id || member.user?._id || member.user
}
