import maxminddb

# Open the database file
location = "asn_ipv4_small.mmdb/asn_ipv4_small.mmdb"
reader = maxminddb.open_database(location)

# 1. View the Structure/Metadata (Database version, IP version, languages, etc.)
print(reader.metadata())

# 2. View specific data for an IP to understand structure
# This reveals the nested dictionaries (e.g., city, country, location)
data = reader.get('8.8.8.8')
print(data)

# Close the reader
reader.close()
