require 'net/http'

# Talks to the domli-bot admin API (the Domli AI assistant service).
# Configure with DOMLI_BOT_URL (default http://bot:3100) and DOMLI_BOT_ADMIN_TOKEN (the bot's ADMIN_TOKEN).
class DomliAi::BotClient
  class Error < StandardError; end

  OPEN_TIMEOUT = 3
  READ_TIMEOUT = 25 # importing a web page can take a while

  def self.configured?
    ENV['DOMLI_BOT_ADMIN_TOKEN'].present?
  end

  def accounts
    request(:get, '/accounts').fetch('accounts')
  end

  def documents(account_id)
    request(:get, "/accounts/#{account_id}/docs").fetch('docs')
  end

  def update_account(account_id, attributes)
    request(:patch, "/accounts/#{account_id}", attributes)
  end

  def add_text(account_id, title:, text:)
    request(:post, "/accounts/#{account_id}/docs", { title: title, text: text })
  end

  def import_url(account_id, url:)
    request(:post, "/accounts/#{account_id}/docs/url", { url: url })
  end

  def delete_document(account_id, document_id)
    request(:delete, "/accounts/#{account_id}/docs/#{document_id}")
  end

  private

  def base_url
    ENV.fetch('DOMLI_BOT_URL', 'http://bot:3100').chomp('/')
  end

  def request(verb, path, body = nil)
    uri = URI("#{base_url}/admin/api#{path}")
    request = Net::HTTP.const_get(verb.to_s.capitalize).new(uri)
    request['Authorization'] = "Bearer #{ENV.fetch('DOMLI_BOT_ADMIN_TOKEN')}"
    request['Content-Type'] = 'application/json'
    request.body = body.to_json if body

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
      http.request(request)
    end
    parsed = JSON.parse(response.body)
    raise Error, parsed['error'] || "Bot gaf status #{response.code}" unless response.is_a?(Net::HTTPSuccess)

    parsed
  rescue JSON::ParserError
    raise Error, 'Onverwacht antwoord van de assistent-service'
  rescue SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout
    raise Error, 'De assistent-service is niet bereikbaar'
  end
end
